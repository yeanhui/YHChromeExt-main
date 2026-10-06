import getCaretCoordinates from "textarea-caret";

export function caretPoint(editor) {
  const bounds = editor.getBoundingClientRect();
  if (
    bounds.bottom < 0 ||
    bounds.right < 0 ||
    bounds.top > innerHeight ||
    bounds.left > innerWidth
  )
    return null;
  let point = {
    x: bounds.left + Math.min(bounds.width / 2, 32),
    y: bounds.top + Math.min(bounds.height / 2, 24),
  };
  try {
    if (editor.localName === "input" || editor.localName === "textarea") {
      if (typeof editor.selectionEnd === "number") {
        const caret = getCaretCoordinates(editor, editor.selectionEnd);
        const scaleX = editor.offsetWidth
          ? bounds.width / editor.offsetWidth
          : 1;
        const scaleY = editor.offsetHeight
          ? bounds.height / editor.offsetHeight
          : 1;
        point = {
          x: bounds.left + (caret.left - editor.scrollLeft) * scaleX,
          y:
            bounds.top +
            (caret.top - editor.scrollTop + caret.height / 2) * scaleY,
        };
      }
    } else {
      const selection =
        editor.getRootNode().getSelection?.() || window.getSelection();
      if (selection?.focusNode && editor.contains(selection.focusNode)) {
        const range = document.createRange();
        range.setStart(selection.focusNode, selection.focusOffset);
        range.collapse(true);
        const rect = range.getClientRects()[0];
        if (rect && rect.height > 0)
          point = { x: rect.left, y: rect.top + rect.height / 2 };
      }
    }
  } catch {}
  return {
    x: Math.max(
      2,
      Math.min(
        innerWidth - 2,
        Math.max(bounds.left, Math.min(bounds.right, point.x)),
      ),
    ),
    y: Math.max(
      2,
      Math.min(
        innerHeight - 2,
        Math.max(bounds.top, Math.min(bounds.bottom, point.y)),
      ),
    ),
  };
}
