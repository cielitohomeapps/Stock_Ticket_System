const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");

function findJavaScriptFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findJavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

const files = [...findJavaScriptFiles(path.join(__dirname, "..", "src")), ...findJavaScriptFiles(path.join(__dirname, "..", "test"))];
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {stdio: "inherit"});
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
