const express = require("express");
const {
  createPaytmOrder,
  paytmCallback,
} = require("../controllers/paytm.controller");

const router = express.Router();

router.post("/create-order", createPaytmOrder);
router.post("/callback", paytmCallback);

module.exports = router;
