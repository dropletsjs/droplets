// Styles reach the client build as an import; core extracts them per droplet.
import "./note.css";

export const hydrate = false;

export default () => `<p class="note">Rendered on the server only.</p>`;
