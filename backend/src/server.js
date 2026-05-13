const {app} = require("./app");

const PORT = Number(process.env.PORT || 3001);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
