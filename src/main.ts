import "./styles/main.css";
import { renderTable } from "./render/table";
import { SAMPLE_RECIPE } from "./sample";

// M2 checkpoint: render the sample tree. Replaced by the full app in M3+.
const app = document.getElementById("app")!;
const wrap = document.createElement("div");
wrap.className = "table-wrap";
wrap.appendChild(renderTable(SAMPLE_RECIPE));
app.appendChild(wrap);
