/** Size a visible composer within its CSS min/max height, without a drag handle. */
export function fitComposer(textarea) {
  if (textarea.tagName !== 'TEXTAREA' || !textarea.getClientRects().length) return;
  const style = textarea.ownerDocument.defaultView.getComputedStyle(textarea);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + (style.boxSizing === 'border-box' ? border : -padding)) + 'px';
  textarea.style.overflowY = textarea.scrollHeight > textarea.clientHeight ? 'auto' : 'hidden';
}

/** One page-level resize handler can cover replaced session views without retaining them. */
export function resizeComposers(root) {
  for (const textarea of root.querySelectorAll('.agent-compose textarea')) fitComposer(textarea);
}

/** Reuse the send action, including its queue/busy guards; IME Enter only confirms text. */
export function bindComposerKeys(textarea, sendButton, canSend) {
  let composing = false;
  const isComposing = event => composing || !!event?.isComposing || event?.keyCode === 229;
  textarea.oncompositionstart = () => { composing = true; };
  textarea.oncompositionend = () => { composing = false; fitComposer(textarea); };
  textarea.onfocus = () => fitComposer(textarea);
  textarea.onkeydown = event => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || isComposing(event)) return;
    if (!canSend()) return;
    event.preventDefault();
    if (!event.repeat && !sendButton.disabled) return sendButton.onclick();
  };
  return isComposing;
}
