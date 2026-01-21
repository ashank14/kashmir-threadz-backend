const supabase = require("../config/supabase");

exports.updateUserName = async (req, res) => {
  try {
    const { userId, fullName } = req.body;

    if (!userId || !fullName) {
      return res.status(400).json({
        error: "userId and name are required",
      });
    }

    const { error } = await supabase
      .from("users")
      .update({ full_name: fullName })
      .eq("id", userId);

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "Failed to update name" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Update name error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
