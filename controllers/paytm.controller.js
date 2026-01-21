const axios = require("axios");
const PaytmChecksum = require("paytmchecksum");
const  supabase  = require("../config/supabase");

exports.createPaytmOrder = async (req, res) => {
  try {
    const { userId, address, items } = req.body;

    /* -------------------- VALIDATION -------------------- */

    if (!userId) return res.status(400).json({ error: "Missing userId" });

    if (!address || typeof address !== "object")
      return res.status(400).json({ error: "Invalid address" });

    if (!address.name?.trim())
      return res.status(400).json({ error: "Name required" });

    if (!/^[6-9]\d{9}$/.test(address.phone || ""))
      return res.status(400).json({ error: "Invalid phone number" });

    if (!address.address?.trim())
      return res.status(400).json({ error: "Address required" });

    if (!address.city?.trim())
      return res.status(400).json({ error: "City required" });

    if (!/^\d{6}$/.test(address.pincode || ""))
      return res.status(400).json({ error: "Invalid pincode" });

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "Cart cannot be empty" });


    /* -------------------- FETCH REAL PRICES -------------------- */
    const productIds = items.map((i) => i.productId);

    const { data: dbProducts, error: dbErr } = await supabase
      .from("products")
      .select("id, price")
      .in("id", productIds);

    if (dbErr)
      return res.status(500).json({ error: "Failed to fetch product prices" });

    // Map prices
    const priceMap = {};
    dbProducts.forEach((p) => (priceMap[p.id] = p.price));

    /* -------------------- CALCULATE TOTAL SECURELY -------------------- */
    let backendTotal = 0;

    for (const item of items) {
      const realPrice = priceMap[item.productId];
      if (!realPrice)
        return res.status(400).json({ error: "Invalid product in cart" });

      backendTotal += realPrice * item.quantity;
    }

    /* Convert to 2-decimal string if needed */
    backendTotal = Number(backendTotal.toFixed(2));

    if (backendTotal < 1)
      return res.status(400).json({ error: "Invalid order amount" });


    /* -------------------- GENERATE ORDER IDs -------------------- */
    const paytmOrderId = crypto.randomUUID().replace(/-/g, "");
    const publicOrderId = "ORD-" + Date.now().toString().slice(-6);


    /* -------------------- CREATE ORDER IN DATABASE -------------------- */
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          user_id: userId,
          status: "PENDING",
          payment_status: "PENDING",
          payment_provider: "PAYTM",

          paytm_order_id: paytmOrderId,
          paytm_txn_id: null,

          total_amount: backendTotal, // secure total

          customer_name: address.name,
          customer_phone: address.phone,
          public_order_id: publicOrderId,

          shipping_address: {
            name: address.name,
            phone: address.phone,
            address: address.address,
            city: address.city,
            state: address.state || "",
            pincode: address.pincode,
          },
        },
      ])
      .select()
      .single();

    if (orderError) {
      console.error("Order Insert Error:", orderError);
      return res.status(500).json({ error: "Could not create order" });
    }

    /* -------------------- INSERT ORDER ITEMS -------------------- */
    const orderItemsToInsert = items.map((item) => ({
      order_id: order.id,
      product_id: item.productId,
      quantity: item.quantity,
      size: item.size || null,
      price_at_purchase: priceMap[item.productId], // real price
    }));

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(orderItemsToInsert);

    if (itemsError) {
      console.error("Order Items Insert Error:", itemsError);
      return res.status(500).json({ error: "Could not create order items" });
    }

    /* -------------------- INIT PAYTM TRANSACTION -------------------- */
    const body = {
      requestType: "Payment",
      mid: process.env.PAYTM_MID,
      websiteName: "WEBSTAGING",
      orderId: paytmOrderId,
      callbackUrl: process.env.PAYTM_CALLBACK_URL,
      txnAmount: {
        value: backendTotal.toString(),
        currency: "INR",
      },
      userInfo: {
        custId: userId.replace(/-/g, ""),
      },
    };

    const signature = await PaytmChecksum.generateSignature(
      JSON.stringify(body),
      process.env.PAYTM_MERCHANT_KEY
    );

    const paytmRes = await axios.post(
      `https://securestage.paytmpayments.com:443/theia/api/v1/initiateTransaction?mid=${process.env.PAYTM_MID}&orderId=${paytmOrderId}`,
      {
        head: { signature },
        body,
      },
      { headers: { "Content-Type": "application/json" } }
    );

    /* -------------------- SEND RESPONSE TO FRONTEND -------------------- */
    return res.json({
      orderId: paytmOrderId,
      publicOrderId,
      paytmToken: paytmRes.data.body.txnToken,
      amount: backendTotal,
    });

  } catch (err) {
    console.error("Create Order Error:", err);
    return res.status(500).json({ error: "Failed to create order" });
  }
};


exports.paytmCallback = async (req, res) => {
  try {
    console.log("PAYTM CALLBACK BODY:", req.body);

    // ⛔ Missing checksum
    if (!req.body.CHECKSUMHASH) {
      return res.status(400).send("Checksum missing");
    }

    const checksum = req.body.CHECKSUMHASH;
    delete req.body.CHECKSUMHASH;

    // 1️⃣ Verify checksum
    const isValid = PaytmChecksum.verifySignature(
      req.body,
      process.env.PAYTM_MERCHANT_KEY,
      checksum
    );

    if (!isValid) {
      return res.status(400).send("Invalid checksum");
    }

    const {
      ORDERID,
      STATUS,
      TXNID,
      TXNAMOUNT,
      PAYMENTMODE,
      TXNDATE,
    } = req.body;

    // 2️⃣ Determine final status
    let finalPaymentStatus = "PENDING";
    let finalOrderStatus = "PENDING";

    if (STATUS === "TXN_SUCCESS") {
      finalPaymentStatus = "SUCCESS";
      finalOrderStatus = "PAID";
    } else if (STATUS === "TXN_FAILURE") {
      finalPaymentStatus = "FAILED";
      finalOrderStatus = "CANCELLED";
    } else if (STATUS === "PENDING" || STATUS === "OPEN") {
      finalPaymentStatus = "PENDING";
      finalOrderStatus = "PENDING";
    } else if (STATUS === "REFUND") {
      finalPaymentStatus = "REFUNDED";
      finalOrderStatus = "REFUNDED";
    }

    // 3️⃣ Update order
    const { data: updatedOrder, error } = await supabase
      .from("orders")
      .update({
        payment_status: finalPaymentStatus,
        status: finalOrderStatus,

        paytm_txn_id: TXNID,
        payment_provider: PAYMENTMODE || "PAYTM",

        // update amount from Paytm response, normalized
        total_amount: Number(TXNAMOUNT),
      })
      .eq("paytm_order_id", ORDERID)
      .select("public_order_id")
      .single();

    if (error) {
      console.error("Supabase Update Error:", error);
    }

    // 4️⃣ Redirect to frontend
    const publicOrder = updatedOrder?.public_order_id ?? ORDERID;

    const successUrl = `${process.env.FRONTEND_URL}/payment-success?order=${publicOrder}`;
    const failedUrl = `${process.env.FRONTEND_URL}/payment-failed?order=${publicOrder}`;

    return res.redirect(
      STATUS === "TXN_SUCCESS" ? successUrl : failedUrl
    );

  } catch (err) {
    console.error("PAYTM CALLBACK ERROR:", err);
    return res.status(500).send("Payment verification failed");
  }
};
