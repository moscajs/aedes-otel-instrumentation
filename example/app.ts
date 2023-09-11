// must be the first import
import './tracing'

import Aedes from 'aedes'
import * as mqtt from 'mqtt'
import http from 'node:http'
import net from 'node:net'

function createMqttClient(): Promise<mqtt.MqttClient> {
  const client = mqtt.connect('mqtt://localhost:1883')
  return new Promise((resolve) => {
    client.once('connect', () => {
      return resolve(client)
    })
  })
}

function createHttpClientRequest(): Promise<http.ClientRequest> {
  return new Promise((resolve) => {
    const req = http.request('http://localhost:3000', (res) => {
      res.on('data', () => {})
      res.on('end', () => {
        return resolve(req)
      })
    })
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
  const broker = new Aedes({})
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
  const broker = await createAedesServer()
  const server = await createHttpServer()

  /**
   * create nested spans with:
   * 1. http client request -> mqtt client publish -> aedes consume -> http server response
   * 2. mqtt client 1 subscribe -> mqtt client 2 publish -> http client request on message -> http server response
   */
  server.on('request', async (req, res) => {
    // console.log('on request ctx:', context.active())

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    // const mqttClient1 = await createMqttClient()
    // await mqttClient1.endAsync(true)

    return res.end('ok')
  })

  // await createHttpClientRequest()
  //

  const mqttClient1 = await createMqttClient()
  broker.on('publish', () => {
    // console.log('on publish ctx:', context.active())
    // console.log(context.active(), ROOT_CONTEXT)
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
