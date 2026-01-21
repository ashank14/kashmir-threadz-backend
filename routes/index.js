const express = require("express");
const router = express.Router();

const paytmRoutes = require("./paytm.routes");

// mount routes
router.use("/paytm", paytmRoutes);
router.use("/user", require("./user.routes")); // 👈 ADD THIS

module.exports = router;
