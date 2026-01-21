const express = require("express");
const router = express.Router();
const { updateUserName } = require("../controllers/user.controller.js");

router.post("/update-name", updateUserName);

module.exports = router;
