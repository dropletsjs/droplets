import "./note.css";

export const hydrate = false;

export default function StaticNote() {
  return <p class="note">Rendered on the server only.</p>;
}
