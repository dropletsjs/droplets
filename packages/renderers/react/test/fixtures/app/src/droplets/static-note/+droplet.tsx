import "./note.css";

export const hydrate = false;

export default function StaticNote() {
  return <p className="note">Rendered on the server only.</p>;
}
