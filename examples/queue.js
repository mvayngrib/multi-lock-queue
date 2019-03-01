const { createLockingQueue } = require('../')
const q = createLockingQueue()
const wait = millis =>
  new Promise(resolve => {
    setTimeout(resolve, millis)
  })

const waitAndPrint = (millis, msg) => wait(millis).then(() => console.log(msg))

q.enqueue(() => waitAndPrint(100, 'a'))
q.enqueue(() => waitAndPrint(50, 'b'))
q.enqueue(() => waitAndPrint(20, 'c'))
