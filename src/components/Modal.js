// src/components/Modal.js
'use client';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Universal Modal component.
 *
 * Mobile  (≤768px) → bottom sheet that slides up, scrollable
 * Desktop (≥769px) → fixed dialog centered in the content area
 *                    (right of the 240px sidebar)
 *
 * Renders via a React portal directly into <body> so no parent
 * stacking context (transform, filter, isolation, etc.) can
 * accidentally trap position:fixed inside a sub-tree.
 *
 * Props:
 *   title    — header string
 *   onClose  — called when backdrop or × is clicked, or Escape pressed
 *   wide     — wider dialog for side-by-side form layouts
 *   children — modal body content
 */
export default function Modal({ title, onClose, wide = false, children }) {
  const portalRef = useRef(null);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Create portal target once
  if (!portalRef.current && typeof document !== 'undefined') {
    portalRef.current = document.body;
  }

  const modal = (
    <>
      {/* Full-screen blurred backdrop — click anywhere to close */}
      <div className="dt-overlay" onClick={onClose} aria-hidden="true" />

      {/* Dialog sheet — stops click from reaching backdrop */}
      <div
        className={`dt-sheet${wide ? ' dt-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dt-modal-title"
      >
        <div className="dt-handle" aria-hidden="true" />
        <div className="dt-body">
          <div className="dt-head">
            <h3 className="dt-title" id="dt-modal-title">{title}</h3>
            <button className="dt-close" onClick={onClose} aria-label="Close modal">×</button>
          </div>
          {children}
        </div>
      </div>
    </>
  );

  // Portal into body — bypasses any stacking context in the component tree
  if (typeof document !== 'undefined') {
    return createPortal(modal, document.body);
  }

  return modal;
}
