import { FC } from 'react';

interface Props {
  name: string;
  setName: (v: string) => void;
  onConfirm: () => void;
}

const NameModal: FC<Props> = ({ name, setName, onConfirm }) => (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
    <div className="bg-white p-6 rounded-xl space-y-4 w-80">
      <h2 className="text-xl font-semibold">Enter your name</h2>
      <input
        className="border p-2 w-full rounded"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <button
        className="w-full py-2 bg-green-600 text-white rounded disabled:opacity-50"
        disabled={!name.trim()}
        onClick={onConfirm}
      >
        Continue
      </button>
    </div>
  </div>
);

export default NameModal;
