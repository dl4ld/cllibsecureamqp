const SecureAmqp = require('./secureamqp.js')

module.exports = function Data(name, type, curator) {
	this.curator = curator
	this.name = name
	this.type = type
	this.value = null
	this.iat = new Date().toISOString()
	this.mat = this.iat
	this.createdBy = function(process, params) {
		return {
			process: process,
			withParams: params
		}
	}
	this.authActors = [this.curator.id()]
	this.listeners = []
	this.addListener = function(cb) {
		this.listeners.push(cb)
	}
	this.update = function(value) {
		this.value = value
		this.mat = new Date().toISOString()
	}
	this.manifest = function() {
		return {
			name: this.name,
			type: this.type,
			curator: this.curator.id(),
			iat: this.iat,
			mat: this.mat,
			createdBy: this.createdBy(),
			authActors: this.authActors
		}
	}
}

