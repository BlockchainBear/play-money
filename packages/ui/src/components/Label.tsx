import React from 'react';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ children, ...props }, ref) => {
  return (
    <label
      ref={ref}
      {...props}
      style={{
        display: 'block',
        marginBottom: '4px',
        fontWeight: 'bold',
      }}
    >
      {children}
    </label>
  );
});

Label.displayName = 'Label';
