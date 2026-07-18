import React, { useRef, useEffect } from 'react';

/** Lightweight HTML editor (bold/italic/underline/lists/headings/links) for form instructions. */
export default function RichTextEditor({ value, onChange, placeholder }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = (cmd, arg = null) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current.innerHTML);
  };

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <button type="button" title="Bold" onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" title="Italic" onClick={() => exec('italic')}><i>I</i></button>
        <button type="button" title="Underline" onClick={() => exec('underline')}><u>U</u></button>
        <button type="button" title="Heading" onClick={() => exec('formatBlock', 'h3')}>H</button>
        <button type="button" title="Bullet list" onClick={() => exec('insertUnorderedList')}>• List</button>
        <button type="button" title="Numbered list" onClick={() => exec('insertOrderedList')}>1. List</button>
        <button type="button" title="Link" onClick={() => { const url = prompt('Link URL'); if (url) exec('createLink', url); }}>Link</button>
        <button type="button" title="Clear formatting" onClick={() => exec('removeFormat')}>Clear</button>
      </div>
      <div
        ref={ref}
        className="rte-body"
        contentEditable
        data-placeholder={placeholder}
        onInput={() => onChange(ref.current.innerHTML)}
        suppressContentEditableWarning
      />
    </div>
  );
}
