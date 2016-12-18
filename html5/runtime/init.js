import { registerElement } from './vdom/element-types'
import { services } from './service'
import runtimeConfig from './config'

let frameworks

const versionRegExp = /^\s*\/\/ *(\{[^}]*\}) *\r?\n/

/**
 * Detect a JS Bundle code and make sure which framework it's based to. Each JS
 * Bundle should make sure that it starts with a line of JSON comment and is
 * more that one line.
 * @param  {string} code
 * @return {object}
 */
function checkVersion (code) {
  let info
  const result = versionRegExp.exec(code)
  if (result) {
    try {
      info = JSON.parse(result[1])
    }
    catch (e) {}
  }
  return info
}

const instanceMap = {}

/**
 * Check which framework a certain JS Bundle code based to. And create instance
 * by this framework.
 * @param {string} id
 * @param {string} code
 * @param {object} config
 * @param {object} data
 */
function createInstance (id, code, config, data) {
  let info = instanceMap[id]
  if (!info) {
    // Init instance info.
    info = checkVersion(code) || {}
    if (!frameworks[info.framework]) {
      info.framework = 'Weex'
    }
    info.created = Date.now()
    instanceMap[id] = info

    // Init instance config.
    config = JSON.parse(JSON.stringify(config || {}))
    config.bundleVersion = info.version
    config.env = JSON.parse(JSON.stringify(global.WXEnvironment || {}))
    console.debug(`[JS Framework] create an ${info.framework}@${config.bundleVersion} instance from ${config.bundleVersion}`)

    // Init JavaScript services for this instance.
    const serviceObjects = Object.create(null)
    services.forEach(service => {
      const create = service.options.create
      if (create) {
        const result = create(id, { info, runtime: runtimeConfig }, config)
        Object.assign(serviceObjects, result)
      }
    })

    return frameworks[info.framework].createInstance(id, code, config, data, serviceObjects)
  }
  return new Error(`invalid instance id "${id}"`)
}

const methods = {
  createInstance
}

/**
 * Register methods which init each frameworks.
 * @param {string} methodName
 */
function genInit (methodName) {
  methods[methodName] = function (...args) {
    if (methodName === 'registerComponents') {
      checkComponentMethods(args[0])
    }
    for (const name in frameworks) {
      const framework = frameworks[name]
      if (framework && framework[methodName]) {
        framework[methodName](...args)
      }
    }
  }
}

function checkComponentMethods (components) {
  if (Array.isArray(components)) {
    components.forEach((name) => {
      if (name && name.type && name.methods) {
        registerElement(name.type, name.methods)
      }
    })
  }
}

/**
 * Register methods which will be called for each instance.
 * @param {string} methodName
 */
function genInstance (methodName) {
  methods[methodName] = function (...args) {
    const id = args[0]
    const info = instanceMap[id]
    if (info && frameworks[info.framework]) {
      const result = frameworks[info.framework][methodName](...args)

      // Lifecycle methods
      if (methodName === 'refreshInstance') {
        services.forEach(service => {
          const refresh = service.options.refresh
          if (refresh) {
            refresh(id, { info, runtime: runtimeConfig })
          }
        })
      }
      else if (methodName === 'destroyInstance') {
        services.forEach(service => {
          const destroy = service.options.destroy
          if (destroy) {
            destroy(id, { info, runtime: runtimeConfig })
          }
        })
        delete instanceMap[id]
      }

      return result
    }
    return new Error(`invalid instance id "${id}"`)
  }
}

/**
 * Adapt some legacy method(s) which will be called for each instance. These
 * methods should be deprecated and removed later.
 * @param {string} methodName
 * @param {string} nativeMethodName
 */
function adaptInstance (methodName, nativeMethodName) {
  methods[nativeMethodName] = function (...args) {
    const id = args[0]
    const info = instanceMap[id]
    if (info && frameworks[info.framework]) {
      return frameworks[info.framework][methodName](...args)
    }
    return new Error(`invalid instance id "${id}"`)
  }
}

export default function init (config) {
  frameworks = config.frameworks || {}

  // Init each framework by `init` method and `config` which contains three
  // virtual-DOM Class: `Document`, `Element` & `Comment`, and a JS bridge method:
  // `sendTasks(...args)`.
  for (const name in frameworks) {
    const framework = frameworks[name]
    framework.init(config)
  }

  // @todo: The method `registerMethods` will be re-designed or removed later.
  ; ['registerComponents', 'registerModules', 'registerMethods'].forEach(genInit)

  ; ['destroyInstance', 'refreshInstance', 'receiveTasks', 'getRoot'].forEach(genInstance)

  adaptInstance('receiveTasks', 'callJS')

  return methods
}
