import React from 'react';

/** Parent support over WhatsApp — clicking opens a chat with the support
 *  number (WhatsApp app on phones, WhatsApp Web on computers). */
export const SUPPORT_WHATSAPP = '918918048059'; // +91 891 804 8059

export default function WhatsAppSupport({ text, label = '💬 WhatsApp Support', small = false }) {
  const msg = text || 'Hello, I need help with the school admission portal.';
  const href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(msg)}`;
  return (
    <a className={`wa-btn ${small ? 'wa-small' : ''}`} href={href} target="_blank" rel="noreferrer">
      <svg viewBox="0 0 32 32" width={small ? 14 : 17} height={small ? 14 : 17} fill="currentColor" aria-hidden="true">
        <path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.1.6 4.1 1.6 5.9L4 29l8.4-1.6c1.7.9 3.6 1.4 5.6 1.4 6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.3l-.4-.2-5 1 1-4.8-.3-.4c-1-1.6-1.5-3.4-1.5-5.2 0-5.5 4.6-10 10.2-10s10.2 4.5 10.2 10-4.6 9.9-10.2 9.9zm5.6-7.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6-.1-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1-1.1 2.5s1.1 2.9 1.3 3.1c.2.2 2.2 3.4 5.4 4.7.8.3 1.4.5 1.8.7.8.2 1.5.2 2 .1.6-.1 1.8-.7 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.4z"/>
      </svg>
      {label}
    </a>
  );
}
