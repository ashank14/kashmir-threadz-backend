require("dotenv").config(); // 👈 MUST be first

const express = require("express");
const bodyParser = require("body-parser");
const routes = require("./routes");
const cors=require("cors");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: false }));

app.get('/hello', (req, res) => {
  res.status(200).send('Hello from Ashank🐱');
});
app.use("/api", routes);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
