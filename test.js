if (process.env.NODE_ENV !== 'test') {
  throw new Error('please run with NODE_ENV=test')
}

const test = require('tape')
const { createLockingQueue } = require('./')
const wait = millis => new Promise(resolve => setTimeout(resolve, millis))
const waitAndReturn = (millis, result) => wait(millis).then(() => result)
const toTask = (locks, i) => ({ locks, name: i, duration: 50 })
const getTaskName = t => t.name

const tasksFixture = [
  ['a', 'b', 'c'],
  ['d'],
  ['a'],
  ['b', 'c'],
  ['a', 'b', 'c'],
].map(toTask)

const orderFixture = [
  {
    name: 'mostly in order',
    tasks: [
      ['a', 'b', 'c'],
      ['d'],
      ['a'],
      ['a', 'b'],
      ['b', 'c'],
    ].map(toTask),
    concurrent: [
      [0, 1],     // a,b,c & d
      [1, 2],     // d & a
      [1, 2, 4]   // d & a & b,c
    ],
    initialConcurrency: 2,
    initialQueueSize: 3,
    results: [0, 1, 2, 4, 3],
  },
  {
    name: 'all concurrent',
    tasks: [
      ['a'],
      ['b'],
      ['c'],
      ['d'],
      ['e'],
    ].map(toTask),
    initialConcurrency: 5,
    initialQueueSize: 0,
    results: [0, 1, 2, 3, 4],
  },
  {
    name: 'stable (competing tasks execute in order they were enqueued)',
    tasks: [
      ['a', 'b'],
      ['b'],
      ['c'],
      ['b'],
    ].map(toTask),
    concurrent: [
      [ 0, 2 ], // a,b & c
      [ 2, 1 ]  // c & b
    ],
    initialConcurrency: 2,
    initialQueueSize: 2,
    results: [0, 2, 1, 3],
  },
  {
    name: 'all mutually exclusive',
    tasks: [
      ['a', 'b', 'c'],
      ['b', 'c', 'd'],
      ['c', 'd', 'e'],
    ].map(toTask),
    concurrent: [],
    initialConcurrency: 1,
    initialQueueSize: 2,
    results: [0, 1, 2],
  },
  {
    name: 'failure tolerance',
    tasks: (() => {
      const tasks = [
        ['a'],
        ['a', 'b'],
        ['a', 'b', 'c'],
      ].map(toTask)

      tasks[1].fail = true
      return tasks
    })(),
    concurrent: [],
    initialConcurrency: 1,
    initialQueueSize: 2,
    results: [0, 2],
    errors: [1],
  },
]

const setup = () => {
  const q = createLockingQueue()
  const results = []
  const errors = []
  const createDelayedEchoNameTask = ({ name, locks, duration = 1000, fail }) => ({
    name,
    fn: async () => {
      await wait(duration)
      if (fail) throw new Error(`task failed: ${name}`)
      return name
    },
    locks
  })

  const enqueue = async task => {
    let result
    try {
      result = await q.enqueue(createDelayedEchoNameTask(task))
    } catch (err) {
      errors.push(task.name)
      return
    }

    results.push(result)
    return result
  }

  return {
    q,
    enqueue,
    results,
    errors,
    getRunning: () => q._getRunning().map(getTaskName),
    getQueued: () => q._getQueued().map(getTaskName)
  }
}

test('order of execution, concurrency', async t => {
  await Promise.all(orderFixture.map(async ({ tasks, ...expected }) => {
    const { enqueue, errors, results, getRunning, getQueued, q } = setup()
    const concurrent = []
    q.ee.on('concurrent', tasks => concurrent.push(tasks.map(getTaskName)))

    tasks.forEach(enqueue)
    t.equal(q.concurrency, expected.initialConcurrency)
    t.equal(q.size, expected.initialQueueSize)
    await q.onEmpty()

    t.same(results, expected.results)
    if (expected.errors) {
      t.same(errors, expected.errors)
    }

    if (expected.concurrent) {
      t.same(concurrent, expected.concurrent)
    }
  }))

  t.end()
})

test('pause, resume, onEmpty', async t => {
  const { enqueue, results, getRunning, getQueued, q } = setup()

  await q.pause()
  t.pass('pauses when nothing is queued or running')
  q.resume()

  const firstHalf = tasksFixture.slice(0, 3)
  const secondHalf = tasksFixture.slice(3)

  firstHalf.forEach(enqueue)
  const pausePromise = q.pause()
  t.equal(pausePromise, q.pause(), 'pause promise is cached')
  secondHalf.forEach(enqueue)

  t.equal(q._queuedBeforePause.length + q.concurrency, firstHalf.length)
  t.equal(q._queued.length, secondHalf.length)

  await pausePromise

  t.deepEqual(results, firstHalf.map(getTaskName))
  t.deepEqual(getRunning(), [])
  t.deepEqual(getQueued(), secondHalf.map(getTaskName))

  q.resume()
  await q.onEmpty()

  t.same(results, tasksFixture.map(getTaskName))
  t.equal(q.concurrency, 0)
  t.equal(q.size, 0)

  tasksFixture.map(enqueue)
  t.equal(q.concurrency, 2)
  t.equal(q.size, tasksFixture.length - 2)

  await q.onEmpty()

  t.end()
})

test('no locks, full concurency', async t => {
  const { enqueue, results, getRunning, getQueued, q } = setup()
  let n = 10

  for (let i = 0; i < n; i++) {
    enqueue({
      name: i,
      duration: 50,
    })
  }

  t.equal(getRunning().length, n)
  t.equal(getQueued().length, 0)
  t.end()
})

test('use as simple queue (with default lock)', async t => {
  const q = createLockingQueue()
  const expectedResults = ['a', 'b', 'c']
  const resultsPromise = Promise.all(expectedResults.map(result => {
    return q.enqueue(() => waitAndReturn(50, result))
  }))

  t.equal(q._getRunning().length, 1)
  t.equal(q._getQueued().length, 2)
  t.same(await resultsPromise, expectedResults)

  t.end()
})
