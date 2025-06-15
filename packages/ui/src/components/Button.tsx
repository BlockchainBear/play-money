import React from 'react';

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      {...props}
      style={{
        padding: '8px 16px',
        border: '1px solid #ccc',
        borderRadius: '4px',
        cursor: 'pointer',
        backgroundColor: '#f0f0f0',
      }}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';
