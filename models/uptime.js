const mongoose = require("mongoose");
const { Schema } = mongoose;

const Uptime = new Schema({
	url: {
		type: String,
		required: true
	},
	timeInterval: {
		type: Number,
		required: true
	},
	author: {
		type: Number,
		required: true
	}
}, {
	timestamps: true
});

const UptimeModel = mongoose.model("uptimes", Uptime);
module.exports = UptimeModel;