import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";

export default function StaffLookupDialog({ id, title, onDismiss, children }) {
  const dismissButton = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    dismissButton.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  // The moderation column is transformed and scrollable. A portal lets this
  // overlay cover the viewport, like the existing See Warnings popup.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDismiss();
        } else if (event.key === "Tab") {
          event.preventDefault();
          dismissButton.current?.focus();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--theme-background-1)",
        color: "var(--theme-text-1)",
        display: "flex",
        padding: "12px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          margin: "auto",
          padding: "5px",
          width: "560px",
          maxWidth: "100%",
          border: "1px solid var(--theme-text-1)",
          borderRadius: "10px",
          background: "var(--theme-background-1)",
        }}
      >
        <h2 id={`${id}-title`} style={{ fontFamily: '"Roboto", sans-serif', textAlign: "center" }}>
          {title}
        </h2>
        <div
          style={{
            maxHeight: "min(300px, 60vh)",
            border: "1px solid var(--theme-background-1)",
            borderRadius: "5px",
            background: "var(--theme-background-3)",
            padding: "5px",
            overflowY: "auto",
            overflowWrap: "anywhere",
          }}
        >
          {children}
        </div>
        <input
          ref={dismissButton}
          type="button"
          value="Dismiss"
          onClick={onDismiss}
          style={{
            width: "60%",
            height: "25px",
            margin: "15px 20%",
            borderRadius: "5px",
            fontFamily: '"Roboto", sans-serif',
            fontWeight: "bold",
            cursor: "pointer",
          }}
        />
      </div>
    </div>,
    document.body
  );
}

StaffLookupDialog.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  onDismiss: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};
