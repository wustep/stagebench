import React from 'react';

interface OledDisplayProps {
  id: string;
  title: string;
  lines: string[];
  subInfo?: string;
  badge?: string;
}

export const OledDisplay: React.FC<OledDisplayProps> = ({
  id,
  title,
  lines,
  subInfo,
  badge,
}) => {
  return (
    <div id={id} className="oled-display-screen" role="region" aria-label={`OLED Display: ${title}`}>
      <div className="oled-bezel">
        <div className="oled-header">
          <span className="oled-title">{title}</span>
          {badge && <span className="oled-badge">{badge}</span>}
        </div>
        <div className="oled-content">
          {lines.map((line, idx) => (
            <div key={idx} className={`oled-line oled-line-${idx}`}>
              {line}
            </div>
          ))}
        </div>
        {subInfo && (
          <div className="oled-footer">
            <span className="oled-subinfo">{subInfo}</span>
          </div>
        )}
      </div>
    </div>
  );
};
