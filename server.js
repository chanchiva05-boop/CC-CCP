const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PDF_DIR = path.join(__dirname, "pdfs");

app.use(express.static(path.join(__dirname, "public")));
app.use("/pdfs", express.static(PDF_DIR, {
  setHeaders: (res) => res.setHeader("Content-Disposition", "inline")
}));

app.get("/api/pdfs", (req, res) => {
  fs.readdir(PDF_DIR, { withFileTypes: true }, (err, entries) => {
    if (err) return res.status(500).json({ error: "Cannot read pdfs folder" });

    const files = entries
      .filter(e => e.isFile() && path.extname(e.name).toLowerCase() === ".pdf")
      .map(e => {
        const filename = e.name;
        const base = path.basename(filename, ".pdf");
        return {
          title: prettyTitle(base),
          file: filename,
          url: "/pdfs/" + encodeURIComponent(filename)
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

    res.json(files);
  });
});

function prettyTitle(name) {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

app.listen(PORT, () => {
  console.log(`PDF Library running at http://localhost:${PORT}`);
});
