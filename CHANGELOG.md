

## [0.2.0](https://github.com/moscajs/aedes-otel-instrumentation/compare/v0.1.1...v0.2.0) (2023-10-09)


### Features

* patch  new `aedes.wrapDeliveryFunc` to correctly modify delivery function ([44cbaef](https://github.com/moscajs/aedes-otel-instrumentation/commit/44cbaef2cdb832c601310903e1cb2ac6565a4916))


### Bug Fixes

* introduce middleware in aedes to patch delivery function at init or runtime ([d790cad](https://github.com/moscajs/aedes-otel-instrumentation/commit/d790cadc72818163879e23f8099c4accaf859d5f))
* make broker URL retrieval method safer ([12482fd](https://github.com/moscajs/aedes-otel-instrumentation/commit/12482fd15399636270e2ad7d50250c79b81a4128))
* solve review issues ([5d83cf2](https://github.com/moscajs/aedes-otel-instrumentation/commit/5d83cf24364066d092aae7acdcf73d4324b920a0))
* update aedes patched types ([ad3c224](https://github.com/moscajs/aedes-otel-instrumentation/commit/ad3c224575edb5bc2f3cb5afa4bdba73ae0ca21f))


### Test added

* add script and config to run aedes tests with intrumentation lib ([0f7170a](https://github.com/moscajs/aedes-otel-instrumentation/commit/0f7170a1302ef9b8ce083748e5df00056410b5a0))
* duplicate and patch original aedes tests ([52e9685](https://github.com/moscajs/aedes-otel-instrumentation/commit/52e9685206388e4606234efe76cbf02ebc25345a))


### Chores

* remove unused lib ([2520e36](https://github.com/moscajs/aedes-otel-instrumentation/commit/2520e363b926b44298cbacbda38305594c7b95b1))

## [0.1.1](https://github.com/moscajs/aedes-otel-instrumentation/compare/v0.1.0...v0.1.1) (2023-09-26)


### Bug Fixes

* correctly create and close spans when no client is defined in Aedes methods ([961db1a](https://github.com/moscajs/aedes-otel-instrumentation/commit/961db1ae23676938251e067b8b2dc4b747511a6f))


### Test added

* ensure broker.subscribe can be used by consumer ([15de1a4](https://github.com/moscajs/aedes-otel-instrumentation/commit/15de1a4272734ba7922d8043a40694e03156cc9d))


### Chores

* add changelog generator ([8970b43](https://github.com/moscajs/aedes-otel-instrumentation/commit/8970b4328ae01b21fe54f8176db12673da2f5e09))