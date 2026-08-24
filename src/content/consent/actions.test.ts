// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeAction, type ActionContext } from "./actions";
import { newContext } from "./tools";
import { REJECT_ALL } from "./types";
import type { ActionConfig } from "./types";

beforeEach(() => {
  document.body.innerHTML = "";
});

function ctx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    find: newContext(document.body),
    consentTypes: { ...REJECT_ALL },
    runMethod: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("click", () => {
  it("clicks the matched element", async () => {
    document.body.innerHTML = '<button class="reject"></button>';
    const btn = document.querySelector(".reject") as HTMLButtonElement;
    const onClick = vi.fn();
    btn.addEventListener("click", onClick);
    await executeAction({ type: "click", target: { selector: ".reject" } }, ctx());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the target doesn't exist", async () => {
    document.body.innerHTML = "<div></div>";
    await expect(executeAction({ type: "click", target: { selector: ".missing" } }, ctx())).resolves.toBeUndefined();
  });
});

describe("hide", () => {
  it("sets display:none on the matched element", async () => {
    document.body.innerHTML = '<div class="banner"></div>';
    await executeAction({ type: "hide", target: { selector: ".banner" } }, ctx());
    const el = document.querySelector(".banner") as HTMLElement;
    expect(el.style.display).toBe("none");
  });

  it("marks the element hiddenFromDetection when requested", async () => {
    document.body.innerHTML = '<div class="banner"></div>';
    const c = ctx();
    await executeAction({ type: "hide", target: { selector: ".banner" }, hideFromDetection: true }, c);
    const el = document.querySelector(".banner") as HTMLElement;
    expect(c.find.hiddenFromDetection.has(el)).toBe(true);
  });
});

describe("list", () => {
  it("runs every sub-action in order", async () => {
    document.body.innerHTML = '<button class="a"></button><button class="b"></button>';
    const order: string[] = [];
    document.querySelector(".a")!.addEventListener("click", () => order.push("a"));
    document.querySelector(".b")!.addEventListener("click", () => order.push("b"));
    const action: ActionConfig = {
      type: "list",
      actions: [
        { type: "click", target: { selector: ".a" } },
        { type: "click", target: { selector: ".b" } },
      ],
    };
    await executeAction(action, ctx());
    expect(order).toEqual(["a", "b"]);
  });
});

describe("ifcss", () => {
  it("runs trueAction when the selector matches", async () => {
    document.body.innerHTML = '<div class="present"></div><button class="yes"></button>';
    const onClick = vi.fn();
    document.querySelector(".yes")!.addEventListener("click", onClick);
    const action: ActionConfig = {
      type: "ifcss",
      target: { selector: ".present" },
      trueAction: { type: "click", target: { selector: ".yes" } },
      falseAction: { type: "click", target: { selector: ".no" } },
    };
    await executeAction(action, ctx());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("runs falseAction when the selector doesn't match", async () => {
    document.body.innerHTML = '<button class="no"></button>';
    const onClick = vi.fn();
    document.querySelector(".no")!.addEventListener("click", onClick);
    const action: ActionConfig = {
      type: "ifcss",
      target: { selector: ".absent" },
      trueAction: { type: "click", target: { selector: ".yes" } },
      falseAction: { type: "click", target: { selector: ".no" } },
    };
    await executeAction(action, ctx());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("waitcss", () => {
  it("resolves immediately once the selector already matches", async () => {
    document.body.innerHTML = '<div class="ready"></div>';
    await expect(
      executeAction({ type: "waitcss", target: { selector: ".ready" }, retries: 0, waitTime: 1 }, ctx())
    ).resolves.toBeUndefined();
  });

  it("gives up after exhausting retries rather than hanging", async () => {
    document.body.innerHTML = "<div></div>";
    await expect(
      executeAction({ type: "waitcss", target: { selector: ".never" }, retries: 2, waitTime: 1 }, ctx())
    ).resolves.toBeUndefined();
  });
});

describe("foreach", () => {
  it("runs the sub-action once per matched element, scoped to each as the new base", async () => {
    document.body.innerHTML = `
      <div class="row"><button class="reject"></button></div>
      <div class="row"><button class="reject"></button></div>
    `;
    const clicks: HTMLElement[] = [];
    document.querySelectorAll(".reject").forEach((btn) => btn.addEventListener("click", (e) => clicks.push(e.currentTarget as HTMLElement)));
    const action: ActionConfig = {
      type: "foreach",
      target: { selector: ".row" },
      action: { type: "click", target: { selector: ":scope .reject" } },
    };
    await executeAction(action, ctx());
    expect(clicks).toHaveLength(2);
  });
});

describe("consent -- this is the core correctness surface for default-reject", () => {
  it("toggleAction: clicks to flip state only when current state differs from desired (reject)", async () => {
    document.body.innerHTML = '<input type="checkbox" class="marketing" checked />';
    const action: ActionConfig = {
      type: "consent",
      consents: [
        {
          type: "F", // Marketing -- REJECT_ALL wants this false
          matcher: { type: "checkbox", target: { selector: ".marketing" } },
          toggleAction: { type: "click", target: { selector: ".marketing" } },
        },
      ],
    };
    const checkbox = document.querySelector(".marketing") as HTMLInputElement;
    // jsdom's native checkbox .click() already flips .checked itself, same
    // as a real browser -- no manual toggle needed in a listener here.
    await executeAction(action, ctx());
    // Started checked (true), desired is false (REJECT_ALL.F) -- must have clicked to uncheck.
    expect(checkbox.checked).toBe(false);
  });

  it("toggleAction: does not click when the checkbox already matches the desired (reject) state", async () => {
    document.body.innerHTML = '<input type="checkbox" class="marketing" />';
    const onClick = vi.fn();
    document.querySelector(".marketing")!.addEventListener("click", onClick);
    const action: ActionConfig = {
      type: "consent",
      consents: [
        {
          type: "F",
          matcher: { type: "checkbox", target: { selector: ".marketing" } },
          toggleAction: { type: "click", target: { selector: ".marketing" } },
        },
      ],
    };
    await executeAction(action, ctx());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("trueAction/falseAction pair: runs falseAction for a rejected (false) category", async () => {
    document.body.innerHTML = '<button class="reject-f"></button><button class="accept-f"></button>';
    const rejectClick = vi.fn();
    const acceptClick = vi.fn();
    document.querySelector(".reject-f")!.addEventListener("click", rejectClick);
    document.querySelector(".accept-f")!.addEventListener("click", acceptClick);
    const action: ActionConfig = {
      type: "consent",
      consents: [
        {
          type: "F",
          trueAction: { type: "click", target: { selector: ".accept-f" } },
          falseAction: { type: "click", target: { selector: ".reject-f" } },
        },
      ],
    };
    await executeAction(action, ctx());
    expect(rejectClick).toHaveBeenCalledTimes(1);
    expect(acceptClick).not.toHaveBeenCalled();
  });

  it("a category not present in consentTypes defaults to false (reject), never true", async () => {
    document.body.innerHTML = '<button class="reject-x"></button>';
    const rejectClick = vi.fn();
    document.querySelector(".reject-x")!.addEventListener("click", rejectClick);
    const action: ActionConfig = {
      type: "consent",
      consents: [{ type: "X", falseAction: { type: "click", target: { selector: ".reject-x" } } }],
    };
    await executeAction(action, ctx({ consentTypes: {} as never }));
    expect(rejectClick).toHaveBeenCalledTimes(1);
  });

  it("onoff matcher path: clicks falseAction to turn off a category that's currently on", async () => {
    document.body.innerHTML = '<div class="on"></div><button class="turn-off"></button>';
    const onClick = vi.fn(() => {
      document.querySelector(".on")!.remove();
    });
    document.querySelector(".turn-off")!.addEventListener("click", onClick);
    const action: ActionConfig = {
      type: "consent",
      consents: [
        {
          type: "B",
          matcher: { type: "onoff", onMatcher: { selector: ".on" }, offMatcher: { selector: ".off" } },
          falseAction: { type: "click", target: { selector: ".turn-off" } },
        },
      ],
    };
    await executeAction(action, ctx());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("ifallowall / ifallownone against REJECT_ALL", () => {
  it("ifallownone takes trueAction when every category is rejected (the REJECT_ALL default)", async () => {
    document.body.innerHTML = '<button class="yes"></button>';
    const onClick = vi.fn();
    document.querySelector(".yes")!.addEventListener("click", onClick);
    const action: ActionConfig = { type: "ifallownone", trueAction: { type: "click", target: { selector: ".yes" } } };
    await executeAction(action, ctx());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ifallowall takes falseAction (not trueAction) under the REJECT_ALL default", async () => {
    document.body.innerHTML = '<button class="no"></button>';
    const onClick = vi.fn();
    document.querySelector(".no")!.addEventListener("click", onClick);
    const action: ActionConfig = { type: "ifallowall", falseAction: { type: "click", target: { selector: ".no" } } };
    await executeAction(action, ctx());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("runrooted", () => {
  it("scopes the sub-action's selectors to the resolved root", async () => {
    document.body.innerHTML = `
      <div class="panel-a"><button class="reject"></button></div>
      <div class="panel-b"><button class="reject"></button></div>
    `;
    const panelAReject = document.querySelector(".panel-a .reject") as HTMLElement;
    const panelBReject = document.querySelector(".panel-b .reject") as HTMLElement;
    const clickedA = vi.fn();
    const clickedB = vi.fn();
    panelAReject.addEventListener("click", clickedA);
    panelBReject.addEventListener("click", clickedB);

    const action: ActionConfig = {
      type: "runrooted",
      target: { selector: ".panel-a" },
      action: { type: "click", target: { selector: ":scope .reject" } },
    };
    await executeAction(action, ctx());
    expect(clickedA).toHaveBeenCalledTimes(1);
    expect(clickedB).not.toHaveBeenCalled();
  });
});

describe("runmethod", () => {
  it("delegates to the provided runMethod callback", async () => {
    const runMethod = vi.fn(async () => {});
    await executeAction({ type: "runmethod", method: "CUSTOM_STEP" }, ctx({ runMethod }));
    expect(runMethod).toHaveBeenCalledWith("CUSTOM_STEP");
  });
});

describe("deliberately unsupported/no-op actions", () => {
  it("close does not close the window or throw", async () => {
    await expect(executeAction({ type: "close" }, ctx())).resolves.toBeUndefined();
  });

  it("slide is a safe no-op", async () => {
    await expect(
      executeAction({ type: "slide", target: { selector: ".x" }, dragTarget: { selector: ".y" }, axis: "x" } as ActionConfig, ctx())
    ).resolves.toBeUndefined();
  });
});
