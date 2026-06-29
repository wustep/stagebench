import { createKeyModel } from '../hardware';

interface KeyboardProps {
  pressedKeys: Set<string>;
  onPress: (id: string) => void;
  onRelease: (id: string) => void;
}

export function Keyboard({ pressedKeys, onPress, onRelease }: KeyboardProps) {
  const { white, black } = createKeyModel();
  return (
    <div className="keybed" data-key-count="88" data-action="hammer action" data-range="A to C">
      <div className="white-keys" aria-label="88 key hammer action keyboard, A to C">
        {white.map((key) => (
          <button
            type="button"
            key={key.id}
            className={`piano-key white-key ${pressedKeys.has(key.id) ? 'is-pressed' : ''}`}
            aria-label={`${key.note} white key`}
            onPointerDown={() => onPress(key.id)}
            onPointerUp={() => onRelease(key.id)}
            onPointerLeave={() => pressedKeys.has(key.id) && onRelease(key.id)}
          />
        ))}
      </div>
      <div className="black-keys" aria-hidden="false">
        {black.map((key) => {
          const whitePosition = Math.floor(key.index * (7 / 12));
          return (
            <button
              type="button"
              key={key.id}
              className={`piano-key black-key ${pressedKeys.has(key.id) ? 'is-pressed' : ''}`}
              style={{ left: `${((whitePosition + 0.66) / 52) * 100}%` }}
              aria-label={`${key.note} black key`}
              onPointerDown={() => onPress(key.id)}
              onPointerUp={() => onRelease(key.id)}
              onPointerLeave={() => pressedKeys.has(key.id) && onRelease(key.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
