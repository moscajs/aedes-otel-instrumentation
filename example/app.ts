// must be the first import
import './tracing'

import { context, trace } from '@opentelemetry/api'
import Aedes from 'aedes'
import * as mqtt from 'mqtt'
import http, { RequestOptions } from 'node:http'
import net from 'node:net'

function createMqttClient(): Promise<mqtt.MqttClient> {
  const client = mqtt.connect('mqtt://localhost:1883')
  return new Promise((resolve) => {
    client.once('connect', () => {
      return resolve(client)
    })
  })
}

function createHttpClientRequest(
  options: string | RequestOptions = 'http://localhost:3000',
  data?: string | Uint8Array
): Promise<http.ClientRequest> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      res
        .setEncoding('utf8')
        .on('data', () => {})
        .on('end', () => resolve(req))
    })
    req.on('error', (e) => reject(e))
    if (data) {
      req.write(data)
    }
    req.end()
  })
}

function createHttpServer(): Promise<http.Server> {
  const server = http.createServer()
  server.listen(3000)
  return new Promise((resolve) => {
    server.once('listening', () => {
      return resolve(server)
    })
  })
}

function createAedesServer(): Promise<Aedes> {
  const broker = new Aedes({
    preConnect: (client, packet, done) => {
      const currentSpan = trace.getSpan(context.active())
      currentSpan?.addEvent('preConnect', { clientId: client.id })
      done(null, true)
    },
    authenticate: (client, username, password, done) => {
      const currentSpan = trace.getSpan(context.active())
      currentSpan?.addEvent('authenticate')
      createHttpClientRequest(
        {
          method: 'POST',
          host: 'localhost',
          port: 3000,
          path: '/authenticate',
        },
        JSON.stringify({ clientId: client.id, username, password })
      )
        .then(() => {
          done(null, true)
        })
        .catch((error) => {
          done(error, false)
        })
    },
  })
  const tcpServer = net.createServer(broker.handle.bind(broker))
  // or  net.createServer((socket) => broker.handle(socket))

  return new Promise((resolve) => {
    broker.once('closed', () => {
      tcpServer.close()
    })
    tcpServer.listen(1883, () => {
      return resolve(broker)
    })
  })
}

async function main() {
  const server = await createHttpServer()

  server.on('request', (req, res) => {
    return res.end('ok')
  })

  const broker = await createAedesServer()

  const mqttClient1 = await createMqttClient()
  broker.on('publish', () => {
    createHttpClientRequest().catch((error) => {
      console.error(error)
      process.exit(1)
    })
  })

  // mqttClient1.on('message', (topic, payload) => {
  //   console.log('message', topic, payload.toString())
  //   console.log('on message ctx:', context.active())

  //   // console.log(context.active(), ROOT_CONTEXT)
  //   createHttpClientRequest().catch((error) => {
  //     console.error(error)
  //     process.exit(1)
  //   })
  // })
  await mqttClient1.subscribeAsync('test')

  const mqttClient2 = await createMqttClient()
  await mqttClient2.publishAsync('test', JSON.stringify({ message: 'test1' }))
  // await mqttClient2.publishAsync('test', JSON.stringify({ message: 'test2' }))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
