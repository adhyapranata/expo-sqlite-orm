import Repository from './Repository'
import DatabaseLayer from 'expo-sqlite-orm/src/DatabaseLayer'
import moment from 'moment'

const isFunction = p =>
  Object.prototype.toString.call(p) === '[object Function]'

export default class BaseModel {
  constructor(obj = {}) {
    this.setProperties(obj)
    return new Proxy(this, this)
  }

  setProperties(props) {
    const cm = this.constructor.columnMapping
    Object.keys(cm).forEach(k => {
      if (props[k] !== undefined) {
        this[k] = props[k]
      } else if (isFunction(cm[k].default)) {
        this[k] = cm[k].default()
      } else {
        this[k] = null
      }
    })
    return this
  }

  get(target, prop) {
    return this[prop] || typeof this[prop] === 'function' ? this[prop] : ''
  }

  static get database() {
    throw new Error('Database não definida')
  }

  static get repository() {
    return new Repository(this.database, this.tableName, this.columnMapping)
  }

  static get tableName() {
    throw new Error('tableName não definido')
  }

  static get columnMapping() {
    return {}
  }

  static createTable() {
    return this.repository.createTable()
  }

  static dropTable() {
    return this.repository.dropTable()
  }

  static create(obj) {
    return this.repository.insert(obj).then(res => new this(res))
  }

  static update(obj) {
    return this.repository.update(obj).then(res => new this(res))
  }

  save() {
    if (this.id) {
      return this.constructor.repository
        .update(this)
        .then(res => this.setProperties(res))
    } else {
      return this.constructor.repository
        .insert(this)
        .then(res => this.setProperties(res))
    }
  }

  destroy() {
    return this.constructor.repository.destroy(this.id)
  }

  static destroy(id, options = {softDelete: false}) {
    if (this.columnMapping.hasOwnProperty('deleted_at') && options.softDelete) {
      return this.find(id).then(res => {
        res.deleted_at = moment().format('YYYY-MM-DD HH:mm:ss')
        return res.save()
      })
    }

    return this.repository.destroy(id)
  }

  static destroyAll() {
    return this.repository.destroyAll()
  }

  static find(id) {
    return this.repository.find(id).then(res => (res ? new this(res) : res))
  }

  static findBy(where) {
    return this.repository
      .findBy(where)
      .then(res => (res ? new this(res) : res))
  }

  /**
   * @param {columns: '*', page: 1, limit: 30, where: {}, order: 'id DESC'} options
   */
  static query(options) {
    return this.repository.query(options)
  }

  static queryRaw ({options}) {
      let whereStatement = options.where ? `WHERE (${options.where})` : ''
      let sortStatement = options.order ? `ORDER BY ${options.order}` : ''
      let limitStatement = (options.limit && options.page) ? `LIMIT ${options.limit} OFFSET ${options.limit * (options.page - 1)}` : ''

      const query = `SELECT ${options.select || '*'} FROM ${this.tableName} ${whereStatement} ${sortStatement} ${limitStatement};`
      const databaseLayer = new DatabaseLayer(this.database, this.tableName)
      return databaseLayer.executeSql(query).then(res => {
          return res.rows.length ? res.rows : []
      })
  }

  static pullAll ({ api, method = 'getAll', params = {}, queryOptions = {page: 1, limit: 15, order: 'id'} }) {
    if (!api) return false
    return api[this.tableName][method]({ params }).then(res => {
      const data = res.data.data.map(item => {
        item['sycned_at'] = moment().format('YYYY-MM-DD HH:mm:ss')
        return item
      })
      const databaseLayer = new DatabaseLayer(this.database, this.tableName)
      return databaseLayer.bulkInsertOrReplace(data).then(res => {
        return this.query(queryOptions)
      })
    })
  }

  static pull ({ api, method = 'get', id, params = {} }) {
    if (!api || !id) return false
    return api[this.tableName][method]({ id, params }).then(res => {
      const data = res.data.data
      data['sycned_at'] = moment().format('YYYY-MM-DD HH:mm:ss')
      const databaseLayer = new DatabaseLayer(this.database, this.tableName)
      return databaseLayer.bulkInsertOrReplace([data]).then(res => {
        return this.find(res[0].insertId)
      })
    })
  }

  static getQueue () {
    const databaseLayer = new DatabaseLayer(this.database, this.tableName)
    return databaseLayer.executeSql(`SELECT * FROM ${this.tableName} WHERE (sycned_at IS NULL OR updated_at > sycned_at OR deleted_at IS NOT NULL);`)
  }

  static pushAll ({ api, methods = {store: 'store', update: 'update', destroy: 'destroy'} }) {
    if (!api) return false
    return this.getQueue()
      .then(res => {
        let instance = null
        let promise = Promise.resolve(null)
        if (!res.rows.length) return promise

        for (let item of res.rows) {
          instance = new this(item)
          if (instance._isNew()) {
            promise = promise.then(() => instance.push({api, method: methods.store, payload: {body: item}}))
          } else if (instance._isUpdated()) {
            promise = promise.then(() => instance.push({api, method: methods.update, payload: {id: item.id, body: item}}))
          } else if (instance._isDestroyed()) {
            promise = promise.then(() => instance.push({api, method: methods.destroy, payload: {id: item.id}}))
          }
        }

        return promise
      }).catch(err => {
        throw err
      })
  }

  push ({ api, method, payload }) {
    if (!api || !method || !payload) return false
    let data = null
    const self = Object.getPrototypeOf(this).constructor

    return api[self.tableName][method](payload).then(res => {
      data = res.data.data

      if (method === 'destroy') {
          return self.destroy(payload.id)
      }

      data['sycned_at'] = moment().format('YYYY-MM-DD HH:mm:ss')
      const databaseLayer = new DatabaseLayer(self.database, self.tableName)
      return databaseLayer.bulkInsertOrReplace([data]).then(res => {
        if (method === 'store') {
          return self.destroy(payload.body.id)
        }

        return Promise.resolve(res)
      })
    }).catch(err => {
        if (err.response && err.response.status === 404) {
            return self.destroy(payload.body ? payload.body.id : payload.id)
        }

        throw err
    })
  }

  _isNew () {
    return !this.sycned_at
  }

  _isUpdated () {
    return moment(this.updated_at).isAfter(this.sycned_at)
  }

  _isDestroyed () {
    return !!this.deleted_at
  }

  _isNotSynced () {
    return this._isNew() || this._isUpdated() || this._isDestroyed()
  }

  hasOne() {
    // TODO: BaseModel:hasOne
    return this
  }

  hasMany() {
    // TODO: BaseModel:hasMany
    return this
  }

  belongsToOne() {
    // TODO: BaseModel:belongsToOne
    return this
  }

  belongsToMany() {
    // TODO: BaseModel:belongsToMany
    return this
  }
}
