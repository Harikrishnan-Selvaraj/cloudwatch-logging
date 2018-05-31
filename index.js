/** MIT License
 * 
 * Copyright (c) [2018] [ Harikrishnan Selvaraj ]
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE. */

const aws4 = require('aws4')
const axios = require('axios')
const lodash = require('lodash')
const path = require('path')
const winston = require('winston')

/**
 * Default configurations
 */
const winstonConfig = winston.config
const DEFAULT_CATEGORY = 'default'
const levels = {
  0: 'error',
  1: 'warn',
  2: 'info',
  3: 'verbose',
  4: 'debug'
}
const logger = {}
let isLocal = true
let level = levels[ 2 ]
let uploadRate = 10000
let retryCount = 5
let _sequenceTokens = new Map()
let logBuffer = []

/**
 * Configure winston logger for console logging
 */
const winstonLogger = new winston.Logger({
  transports: [ new winston.transports.Console({
    json: false,
    exitOnError: true,
    colorize: true,
    timestamp: () => {
    const date = new Date()

    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` +
    ` ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}` +
    `.${date.getMilliseconds()}`
  },
    formatter: (options) => `${winstonConfig.colorize(options.level,
  `[${options.timestamp()}] [${options.level.toUpperCase()}]`) } ${
  options.message ? options.message : ''}`
}) ]
})

/**
 * Get the headers from AWS by signing the request using aws4.sign
 *
 * @param method - action
 * @param region - AWS region
 * @param payload - equets content body
 * @returns {{url: string, headers:
 * {"X-Amz-Target": string, Accept: string, "Content-Type": string}|
 * headers|{"X-Amz-Target", Accept, "Content-Type"}}}
 */
const getRequestParams = (method, region, payload, keys) => {
  const opts = {
    service: 'logs',
    region: region,
    path: `/?Action=${ method}`,
    headers: {
      'X-Amz-Target': `Logs_20140328.${ method}`,
      'Accept': 'application/json',
      'Content-Type': 'application/x-amz-json-1.1'
    }
  }

  if (payload) opts.body = JSON.stringify(payload)

  if (keys.accessKeyId && keys.secretAccessKey)
    aws4.sign(opts, { accessKeyId: keys.accessKeyId, secretAccessKey: keys.secretAccessKey })
  else aws4.sign(opts)

  return {
    url: `https://${ path.posix.join(opts.hostname, opts.path)}`,
    headers: opts.headers
  }
}

/**
 * Set retention policy for log storage
 *
 * @param logGroupName - cloud watch group name
 * @param region - AWS region
 * @param accessKeyId - AWS access ID
 * @param secretAccessKey - AWS secret key
 * @param retentionInDays - retention in days for the logs
 * @returns {Promise<T>}
 */
const setRetentionPolicy = (logGroupName, region, accessKeyId,
  secretAccessKey, retentionInDays) => {
  const service = 'PutRetentionPolicy'
  const payload = {
    logGroupName: logGroupName,
    retentionInDays: retentionInDays
  }
  const requestParams = getRequestParams(service, region, payload,
    { accessKeyId: accessKeyId, secretAccessKey: secretAccessKey })

  const request = axios.create({
    baseURL: requestParams.url,
    headers: requestParams.headers
  })

  return request.post('', payload).then((results) => results.data).catch((err) => {
    throw new Error(err.response.data.message)
  })
}

/**
 * Write logs into cloud watch
 *
 * @param logMessage - Message to be logged
 * @param logGroupName - cloud watch group name
 * @param logStreamName - cloud watch stream name
 * @param region - AWS region
 * @param keys - Obj containing AWS access ID and secret key
 * @param count - failover retry count
 * @param sequenceToken - sequence token from cloud watch response
 * @returns {any}
 */
const writeLogsToCloudWatch = (logMessage, logGroupName, logStreamName,
  region, keys, count, sequenceToken) => {
  const nothingToLog = logMessage.length <= 0
  const service = 'PutLogEvents'
  const payload = {
    logEvents: logMessage,
    logGroupName: logGroupName,
    logStreamName: logStreamName
  }
  const tokenKey = `${logGroupName }__${ logStreamName}`
  const seqToken = sequenceToken || _sequenceTokens.get(tokenKey)

  if (seqToken) payload.sequenceToken = seqToken

  const requestParams = getRequestParams(service, region, payload, keys)
  const request1 = axios.create({
    baseURL: requestParams.url,
    headers: requestParams.headers
  })
  let retries = count

  return (retries > retryCount || nothingToLog) ? Promise.resolve(null) :
    request1.post('', payload).then((results) => {
      const token = results.data.nextSequenceToken

      _sequenceTokens.set(tokenKey, token)
  logBuffer = []

  return 'Success'
}).catch((err) => {
    if(err && err.response && err.response.data) {
    const token = err.response.data.expectedSequenceToken

    if (token) {
      _sequenceTokens.set(tokenKey, token)
      retries += 1
      return writeLogsToCloudWatch(logMessage, logGroupName,
        logStreamName, region, keys, retryCount, token)
    }
    return 'Error while streaming data to cloud watch'
  }

  return err && err.response ? err.response :
    'Error while streaming data to cloud watch'
})
}

/**
 * Updating log level globally
 *
 * @param newLogLevel - String - log level
 */
const updateLogLevel = (newLogLevel) => {
  const lvl = lodash.invert(levels)

  if(lvl.hasOwnProperty(newLogLevel)) {
    winstonLogger.level = newLogLevel
    level = levels[ lvl[ newLogLevel ] ]
  }
}

/**
 * get time stamp in a format as YYYY-MM-DD HH:MM:SS.ms
 * @param date - date Obj
 * @returns {string} - Date string
 */
const getTimeStamp = (date) => `${date.getFullYear() }-${ date.getMonth() + 1 }-${ date.getDate()
  } ${ date.getHours() }:${ date.getMinutes() }:${ date.getSeconds()}` +
`.${ date.getMilliseconds()}`

/**
 * Default format of message to be logged into cloud watch
 * @param logType - log type for the corresponding message
 * @param logMessage - Message
 * @returns {string} - Formatted string
 */
const defaultFormat = ({ logType, logMessage }) =>
`[${ getTimeStamp(new Date()) }] [${ logType.toUpperCase() }]  - ${
  logMessage ? logMessage : ''}`

/**
 * Trigger timer event to write logs into cloud watch
 *
 * @param logGroupName - cloud watch log group name
 * @param logStreamName - cloud watch log stream name
 * @param region - AWS region
 * @param keys - Obj containing AWS access ID and secret key
 * @param count - failover retry count
 */
const triggerTimer = (logGroupName, logStreamName, region, keys, count) => {
  setInterval(() => {
    if (logBuffer.length !== 0)
  writeLogsToCloudWatch(logBuffer, logGroupName, logStreamName, region,
    keys, count)
}, uploadRate > 0 ? uploadRate : 0)
}

/**
 * creates logger obj
 *
 * @param categoryName - Category name for the logger,
 *                        if not specified set to 'default'
 * @returns {string} - Category name
 */
const createLogger = (categoryName) => {
  const category = categoryName ? categoryName : DEFAULT_CATEGORY

  lodash.forIn(levels, (value, key) => {
    if(!logger[ category ])
  logger[ category ] = {}

  logger[ category ][ value ] = () => {}
  if(key <= level)
    logger[ category ][ value ] = (message) => {
    const logType = value

    if(isLocal === false)
      (function (msg) {
        logBuffer.push({
          message: defaultFormat({
            logType: logType,
            logMessage: msg
          }),
          timestamp: Date.now() })
      })(message)

    winstonLogger[ value ](message)
  }
})

  return category
}

/**
 * Config logger for cloud watch and local
 * @param options - object containing config data
 *
 * {
 *    level: string (level - info, debug, error, verbose, warn)
 *    isLocal: boolean (true / false)
 *    // Below are mandatory if isLocal = false
 *    logGroupName: string (cloud watch group name)
 *    logStreamName: string (cloud watch stream name)
 *    region: string (AWS region)
 *    accessKeyId: string (AWS access ID)
 *    secretAccessKey: String (AWS secret key)
 *    uploadRate: milliseconds in Number
 *                (optional - Rate of log upload, default value is 10000 (10s)
 *    retryCount: Failover retry counts (optional - default to 5)
 * }
 */
const config = (options) => {
  if(options) {
    if(options.level) {
      updateLogLevel(options.level)
      lodash.forIn(logger, (value, key) => {
        createLogger(key)
      })
    }
    if(typeof options.isLocal === 'boolean') {
      isLocal = options.isLocal
      if(isLocal === false) {
        const logGroupName = options.logGroupName
        const logStreamName = options.logStreamName
        const region = options.region
        const accessKeyId = options.accessKeyId
        const secretAccessKey = options.secretAccessKey

        if(options.uploadRate)
          uploadRate = options.uploadRate
        const retentionInDays = options.retentionInDays

        if(options.retryCount)
          retryCount = options.retryCount

        if (!logGroupName)
          throw new Error('logGroupName is required')
        else if (!logStreamName) throw new Error('logStreamNameis required')
        else if (!region) throw new Error('region is required')
        else if (!secretAccessKey) throw new Error('secretAccessKey is required')
        else if (!accessKeyId) throw new Error('accessKeyId is required')
        else if (!accessKeyId) throw new Error('accessKeyId is required')
        else {
          setRetentionPolicy(logGroupName, region, accessKeyId, secretAccessKey,
            parseInt(retentionInDays) || 180).then((resp) => {
            if(resp)
            winstonLogger.info('Retention policy has been set to ' +
            `${retentionInDays || 180} days`)
        }).catch((err) => {
            winstonLogger.error(`Unable to set retention policy : ${ err}`)
        })
          lodash.forIn(logger, (value, key) => {
            createLogger(key)
          })
          triggerTimer(logGroupName, logStreamName, region, { accessKeyId, secretAccessKey }, 0)
        }
      }
    }
  }
}

createLogger(DEFAULT_CATEGORY)


module.exports = {
  createLogger: createLogger,
  config: config,
  logger: logger
}
