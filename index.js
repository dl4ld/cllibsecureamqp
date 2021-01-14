const _sodium = require('libsodium-wrappers')
const TAI64 = require('tai64').TAI64
const randomstring = require('randomstring')
const amqp = require('amqplib')
const Redis = require('redis')
const EventEmitter = require('events')

let ex
let amqpChannel
let sodium
// signature keys
let keysB64
let keys
// enc keys
let xkeys
let xkeysB64
let myAddress
let config
let redis
let interval

const myId = {
	address: null,
	name: null,
	type: null,
	functions: []
}

const events = new EventEmitter()

const heartbeat = 5000
const ttl = 60

exports.stopAnnouncing = () => {
	if(interval) {
		clearInterval(interval)
	}
}

exports.events = events

exports.startAnnouncing = () => {
	const key = "cl:actor:" + myId.name + ":" + myId.address + ":info"

	if(interval) {
		clearInterval(interval)
	}

	interval = setInterval(function() {
		redis.setex(key, ttl, JSON.stringify(myId),  () => {
			events.emit("announce", myId)
		})
	}, heartbeat) 

	return interval
}

const sessions = {}
const callbacks = {}

function log(msg, type) {
	type = type || "INFO"
	console.log("[" + type + "] " + msg)
}

exports.init = async (c) => {
	try {
		config = c
		ex = config.rabbit.ex || "dex01"
		await initSodium(config.rabbit)
		log("Init sodium OK.")
		await initAmqp(config.rabbit)
		log("Init rabbit OK.")
		await initRedis(config.redis)
		log("Init redis OK.")
		myId.name = c.name
		myId.type = c.type
	return true
	} catch(err){
		log(err, "ERROR")
		return false
	}
}

exports.securePublish = async (msg, rk, replyTo, endSession) => {
	sendMsg(msg, rk, null, replyTo, () => {
		if(endSession) {
			sendMsg("ending session", rk, "SESSION_KILL", replyTo, () => {
				const to = rk.split('.')[0]
				const session = sessions[to]
				if(session) {
					delete sessions[to]
					log("Deleted local session.")
				}
			})
		}
	})
}

exports.secureSubscribe = (rk, cb) => {
	callbacks[rk] = cb
	return
}

exports.callFunction = (address, path, data, params, cb) => {
	const replyId = randomstring.generate(5)
	this.securePublish(data, address + path, replyId, false)
	const rk = myAddress + '.r.' + replyId
	callbacks[rk] = function(d) {
		cb(d)
	}
}

exports.id = myId

exports.registerFunction = (path, guards, f) => {
	const rk = myAddress + path
	log("Registered function: " + rk)
	myId.functions.push(path)
	const that = this
	callbacks[rk] = function(d) {
		const req = {
			params: d
		}
		const res = {
			send: function(data) {
				const replyRk = d.header.src + ".r." + d.header.replyId
				that.securePublish(data, replyRk, null, false)
			}
		}
		f(req, res)
	}
}

exports.sign = (s) => {
	let signed = Buffer.from(sodium.crypto_sign_detached(s, keys.privateKey)).toString('base64')
	return signed
}

exports.verify = (c, s, k) => {
	c = Buffer.from(c, 'base64')
	let valid = sodium.crypto_sign_verify_detached(c, s, base64toUint8(k))
	return valid
}

exports.decodeToken = (t) => {
	const p = t.split('.')
	return JSON.parse(decodeB64(p[1])) 
}

exports.verifyToken = (t, k) => {
	const p = t.split('.')
	const decoded = {
		header: JSON.parse(decodeB64(p[0])),
		payload: JSON.parse(decodeB64(p[1]))
	}
	if(this.verify(p[2], p[0] + '.' + p[1], decoded.payload.pk)) {
		return true
	} else {
		return false
	}
}

exports.signedToken = (d, m) => {
	m = m || 1440
	const time = new Date()
	const h = {
		alg: "ed25519",
		typ: "jclt"
	}
	const p = {
		issuer: keysB64.publicKey,
		iat: time.toISOString(),
		exp: new Date(time.getTime() + m*60000).toISOString(),
		data: d
	}
	const t = encodeB64(JSON.stringify(h)) + '.' + encodeB64(JSON.stringify(p))
	const s = this.sign(t)

	return t + '.' + s
}

exports.keys = () => {
	return keysB64
}

exports.getMyAddress = () => {
	return keysB64.publicKey
}

function initRedis(c)  {
	config = c
	return new Promise((resolve, reject) => {
		redis = Redis.createClient({
			host: config.host || "127.0.0.1",
			port: config.port || 6379
		})
		redis.on("ready", () => {
			resolve()
		})
		redis.on("error", (err) => {
			reject(err)
		})
	})
}

async function initSodium() {
	await _sodium.ready;
	sodium = _sodium;
	if(config.keysB64) {
		keysB64 = config.keysB64
		keys = {
			publicKey: base64toUint8(keysB64.publicKey),
			privateKey: base64toUint8(keysB64.privateKey)
		}
	} else {
		//keys = sodium.crypto_kx_keypair()
		keys = sodium.crypto_sign_keypair()
		keysB64 = {
			publicKey: uint8toBase64(keys.publicKey),
			privateKey: uint8toBase64(keys.privateKey)
		}
	}
	xkeys = {
		privateKey: sodium.crypto_sign_ed25519_sk_to_curve25519(keys.privateKey),
		publicKey: sodium.crypto_sign_ed25519_pk_to_curve25519(keys.publicKey)
	}
	xkeysB64 = {
		publicKey: uint8toBase64(xkeys.publicKey),
		privateKey: uint8toBase64(xkeys.privateKey)
	}

	myAddress = keysB64.publicKey
	myId.address = keysB64.publicKey
}

async function initAmqp(config) {
	try {
		const conn = await amqp.connect('amqp://' + config.login + ":" + config.password + "@" + config.host)
		const channel = await conn.createChannel()
		amqpChannel = channel
		channel.assertExchange(ex, 'topic', {durable:false})
		if(myAddress) {
			const rk = myAddress + '.#'
			const r = await channel.assertQueue('', {exclusive: true})
			const q = await channel.bindQueue(r.queue, ex, rk)
			channel.consume(r.queue, handler, {noAck: true})
		} else {
			log("Skip queue consumer.")
		}

	} catch(err) {
		log(err, "ERROR")
	}
}

async function deleteSession(msg) {
	let h, m
	[h, m] = await decMsg(msg.content.toString())
	if(h) {
		if(sessions[h.src]) {
			delete sessions[h.src]
		}
	}
}

async function handler(msg) {
    const rk = msg.fields.routingKey
	const p = msg.content.toString().split('.')
	const header = JSON.parse(decodeB64(p[0]))
	const epayload = base64toUint8(p[1])
	const nonce = base64toUint8(p[2])
	log("New message from: " + rk + " of type: " + header.type)
	if(header.type == "SESSION_KILL") {
		deleteSession(msg)
	}
	if(header.type == "SESSION_INIT") {
		createSession(msg, true)
	}
	if(header.type == "SESSION_ACK") {
		createSession(msg, false)
	}
	if(header.type == "SESSION_MSG") {
		const cb = callbacks[msg.fields.routingKey]
		if(cb) {
			let h, m
			[h, m] = await decMsg(msg.content.toString())
			if(!h) {
				return
			}
			h.routingKey = rk
			cb({
				header: h,
				msg: m,
				_orig: msg
			})
		}
	}
	if(header.type == "SESSION_PING") {
		pingPong(msg.content.toString())
	}

}

function updateSession(to, attr) {
	if (!sessions[to]) {
		sessions[to] = {}
	}
	Object.keys(attr).forEach(k => {
		const v = attr[k]
		sessions[to][k] = v
	})
	return sessions[to]
}

async function initSession(to, cb) {
	const ch = amqpChannel
	const mySecret = xkeys.privateKey
	//const hisPublic = base64toUint8(to)
	const hisPublic = sodium.crypto_sign_ed25519_pk_to_curve25519(base64toUint8(to))
	const sharedKey = uint8toBase64(sodium.crypto_aead_xchacha20poly1305_ietf_keygen())
	
	let nonce = sodium.randombytes_buf(24)
	const now = TAI64.now().toHexString()
	updateSession(to, {
		key: sharedKey,
		myNonce: nonce,
		myTime: now,
		state: "SESSION_INIT",
		cb: cb
	})
	const header = {
			version: "v1",
			time: now,
			type: "SESSION_INIT",
			src: myAddress,
			path: "test123"
		}
	const hs = uint8toBase64( sodium.crypto_generichash(32, JSON.stringify(header)) )
	const payload = {
		key: sharedKey,
		_pad: padding(96),
		_headerHash: hs
	}
	let ciphertext = Buffer.from(
		sodium.crypto_box_easy(
        JSON.stringify(payload),
        nonce,
        hisPublic,
        mySecret
    ))

	const headerB64  = encodeB64(JSON.stringify(header))
	const payloadB64 = uint8toBase64(ciphertext)
	const nonceB64 = uint8toBase64(nonce)

	const msg = headerB64 + '.' + payloadB64 + '.' + nonceB64
    await ch.publish(ex, to, Buffer.from(msg));
	log("Sent. INIT")

}

async function ackSession(to, sharedKey) {
	const ch = amqpChannel
	const mySecret = xkeys.privateKey
	//const hisPublic = base64toUint8(to)
	const hisPublic = sodium.crypto_sign_ed25519_pk_to_curve25519(base64toUint8(to))
	const session = sessions[to]
	
	let nonce = sodium.randombytes_buf(24)
	const now = TAI64.now().toHexString();
	updateSession(to, {
		myNonce: nonce,
		myTime: now,
		state: "SESSION_ACK"
	})
	const header = {
			version: "v1",
			time: now,
			type: "SESSION_ACK",
			src: myAddress,
			path: null
	}
	const hs = uint8toBase64( sodium.crypto_generichash(32, JSON.stringify(header)) )
	const payload = {
		key: sharedKey,
		_pad: padding(96),
		_headerHash: hs
	}
	let ciphertext = Buffer.from(
		sodium.crypto_box_easy(
        JSON.stringify(payload),
        nonce,
        hisPublic,
        mySecret
    ))

	const headerB64  = encodeB64(JSON.stringify(header))
	const payloadB64 = uint8toBase64(ciphertext)
	const nonceB64 = uint8toBase64(nonce)

	const msg = headerB64 + '.' + payloadB64 + '.' + nonceB64
    await ch.publish(ex, to, Buffer.from(msg));
	log("Sent. ACK")

}

function createSession(msg, ack) {

    const rk = msg.fields.routingKey
	const p = msg.content.toString().split('.')
	const header = JSON.parse(decodeB64(p[0]))
	const ciphertext = base64toUint8(p[1])
	const nonce = base64toUint8(p[2])

	//const hisPublic = base64toUint8(header.src)
	const hisPublic = sodium.crypto_sign_ed25519_pk_to_curve25519(base64toUint8(header.src))
	const mySecret = xkeys.privateKey

	let decrypted = Buffer.from(
            sodium.crypto_box_open_easy(
                ciphertext,
                nonce,
                hisPublic,
				mySecret
            )
        );
	const body = JSON.parse(new Buffer.from(decrypted).toString())
	const hs = uint8toBase64( sodium.crypto_generichash(32, JSON.stringify(header)) )
	if(hs != body._headerHash) {
		throw Error("Header hash mismatch.")
		return
	}

	updateSession(header.src, {
		key: body.key,
		hisNonce: nonce,
		hisTime: header.time
	})
	log("Received. INIT")

	if(ack) {
		ackSession(header.src, body.key)
	} else {
		const session = sessions[header.src]
		session.state = "SESSION_ACK"
		if(session.cb) {
			session.cb(session)
		}
	}
}

function ping(to) {
	sendMsg("ping", to, "SESSION_PING")
}

async function pingPong(msg) {
	let h, m
	[h, m] = await decMsg(msg)
	const p = (m == 'ping') ? "pong" : "ping"
	setTimeout(() => {
		sendMsg(p, h.src, "SESSION_PING")
	}, 1000)

}

function createHeader(src, dst, type, version, replyId, rk) {
	const now = TAI64.now().toHexString()
	const header = {
			version: version || "v1",
			time: now,
			type: type || "SESSION_MSG",
			src: src,
			dst: dst,
			replyId: replyId,
			routingKey: rk
	}

	return {
		plaintext: JSON.stringify(header),
		base64: encodeB64(JSON.stringify(header)),
		json: header
	}
}

function incNonce(nonce) {
	sodium.increment(nonce)
	return nonce
}

function packMessage(header, payload, nonce) {
	const headerB64 = encodeB64(JSON.stringify(header))
	const payloadB64 = uint8toBase64(payload)
	const nonceB64 = uint8toBase64(nonce)
	return headerB64 + '.' + payloadB64 + '.' + nonceB64
}

function unpackMsg(m) {
	const parts = m.split('.')
	const assocData = decodeB64(parts[0])
	const e = parts[1]
	const nonce = base64toUint8(parts[2])
	return [assocData, e, nonce]
}

function waitForSessionAck(session, cb) {
	const interval = setInterval(function() {
		if(session.state == "SESSION_ACK") {
			clearInterval(interval)
			cb()
		} else {
			log("waiting for SESSION_ACK")
		}
	}, 100)
}

function sendMsg(msg, rk, type, replyTo, cb) {
	const ch = amqpChannel
	const to = rk.split('.')[0]
	const session = sessions[to]
	if(!session) {
		// Create session if not yet started
		initSession(to, function(session) {
			log("Started session.")	
			_send(session)
		})
	} else {
		// Use existing session
		waitForSessionAck(session, function() {
			_send(session)
		})
	}

	function _send(session) {
		const key = base64toUint8(session.key)
		const myNonce = incNonce(session.myNonce)

		const header = createHeader(myAddress, to, type, null, replyTo, rk)
		const payload = {
			msg: msg,
			_pad: padding(96)
		}
		const epayload = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(JSON.stringify(payload), header.plaintext, null, myNonce, key)
		const packedMsg = packMessage(header.json, epayload, myNonce)
		ch.publish(ex, rk, Buffer.from(packedMsg))
		log("Sent. MSG")
		if(cb) cb()
	}
}

async function decMsg(emsg) {
	let ad, em, n
	[ad, em, n] = unpackMsg(emsg)
	const header = JSON.parse(ad)
	const session = sessions[header.src]
	// Check if session was created
	if(!session) {
		log("No Session.", "WARNING")
		return [null, null]
	}
	const nonce = n
	const key = base64toUint8(session.key)
	const lastNonce = session.hisNonce
	const lastTime = session.hisTime
	// Compare nonce: should be larger than previous to prevent replay attack
	if (sodium.compare(lastNonce, nonce) > -1) {
		log("Invalid nonce.", "WARNING")
		return [null, null]
	}
	const t1 = TAI64.fromHexString(lastTime)
	const t2 = TAI64.fromHexString(header.time)
	// Compare time: t2 should be later than t1 to prevent replay attacks
	if(t1.isAfter(t2)) {
		log("Invalid TAI64 time.", "WARNING")
		return [null, null]
	}
	// Decrypt
	const m = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, base64toUint8(em), ad, nonce, key)
	const json = JSON.parse(new Buffer.from(m).toString())
	log("Received msg: " + json.msg)
	// Update session nonce and time
	updateSession(header.src, {
		hisNonce: nonce,
		hisTime: header.time
	})
	return [header, json.msg]
}

function base64toUint8(k) {
  return new Uint8Array(new Buffer.from(k, 'base64'))
}

function uint8toBase64(k) {
  return new Buffer(k, 'hex').toString('base64')
}

function encodeB64(str) {
	const buff = Buffer.from(str, 'utf-8');
	return buff.toString('base64');
}

function decodeB64(base64) {
	const buff = Buffer.from(base64, 'base64');
	return buff.toString('utf-8');
}

function padding(n) {
	n = n || 96
	const r = Math.floor(Math.random() * n) + 5
	return randomstring.generate(r)
}

