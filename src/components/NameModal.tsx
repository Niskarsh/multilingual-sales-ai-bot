import { FC } from 'react';

interface Props {
  name: string;
  setName: (v: string) => void;
  onConfirm: () => void;
}

const NameModal: FC<Props> = ({ name, setName, onConfirm }) => (
  <div className="modal-backdrop">
    <div className="modal-box">
      <h2>Enter your name</h2>

      <input
        value={name}
        placeholder="e.g. Priya"
        onChange={(e) => setName(e.target.value)}
      />

      <button disabled={!name.trim()} onClick={onConfirm}>
        Continue
      </button>
    </div>
  </div>
);

export default NameModal;
