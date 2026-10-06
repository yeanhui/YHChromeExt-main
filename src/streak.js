export const IDLE_MS = 1500;

export class Streak {
  count = 0;
  lastEdit = null;
  target = null;

  hit(target, now) {
    if (
      target !== this.target ||
      this.lastEdit === null ||
      now - this.lastEdit >= IDLE_MS
    ) {
      this.reset();
    }
    this.target = target;
    this.lastEdit = now;
    this.count += 1;
    return { count: this.count, milestone: this.count % 10 === 0 };
  }

  reset() {
    this.count = 0;
    this.lastEdit = null;
    this.target = null;
  }
}

export function eligibleTarget(path) {
  for (const element of path) {
    if (!element || element.nodeType !== 1) continue;
    if (element.localName === "input") {
      return ["text", "search", "email", "url", "tel"].includes(element.type) &&
        !element.disabled &&
        !element.readOnly
        ? element
        : null;
    }
    if (element.localName === "textarea") {
      return !element.disabled && !element.readOnly ? element : null;
    }
    if (element.isContentEditable) {
      let editor = element;
      while (editor.parentElement?.isContentEditable)
        editor = editor.parentElement;
      return editor;
    }
  }
  return null;
}

export function keyboardIntent(event) {
  if (
    !event.isTrusted ||
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return false;
  return (
    event.key.length === 1 || event.key === "Enter" || event.key === "Backspace"
  );
}

export function qualifyingInput(event, intent, target, now) {
  return (
    event.isTrusted &&
    !event.isComposing &&
    intent?.target === target &&
    now - intent.time < 1000 &&
    [
      "insertText",
      "insertLineBreak",
      "insertParagraph",
      "deleteContentBackward",
    ].includes(event.inputType)
  );
}
