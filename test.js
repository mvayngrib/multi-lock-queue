const test = require('tape')
const { createLockingQueue } = require('./')
const wait = millis => new Promise(resolve => setTimeout(resolve, millis))
const tasksFixture = [
  {
    locks: ['a', 'b', 'c']
  },
  {
    locks: ['d']
  },
  {
    locks: ['a']
  },
  {
    locks: ['b', 'c']
  },
  {
    locks: ['a', 'b', 'c']
  }
].map((task, i) => ({ ...task, name: i, duration: 100 }))

const setup = () => {
  const q = createLockingQueue()
  const started = {}
  const results = []
  const createDelayedEchoNameTask = ({ name, locks, duration = 1000 }) => ({
    name,
    fn: async () => {
      started[name] = true
      await wait(duration)
      return name
    },
    locks
  })

  const enqueue = async task => {
    const result = await q.enqueue(createDelayedEchoNameTask(task))
    results.push(result)
    return result
  }

  return {
    q,
    enqueue,
    started,
    results,
    getRunning: () => q.getRunning().map(t => t.name),
    getQueued: () => q.getQueued().map(t => t.name)
  }
}

test('single task', async t => {
  const { enqueue, results, started } = setup()
  const first = tasksFixture[0]
  const promiseFirst = enqueue(first)

  t.equal(started[first.name], true)
  await promiseFirst

  t.deepEqual(results, [first.name], 'task returns correct result')
  t.end()
})

test('parallelize if possible', async t => {
  const { enqueue, results, started, getRunning, getQueued } = setup()
  const oneAndTwo = tasksFixture.slice(0, 2).map(enqueue)

  t.equal(getRunning().length, 2)
  t.equal(getQueued().length, 0)
  t.equal(started[tasksFixture[0].name], true)
  t.equal(started[tasksFixture[1].name], true)
  await Promise.all(oneAndTwo)

  t.deepEqual(results, tasksFixture.slice(0, 2).map(t => t.name), 'tasks queued in parallel return correct results')

  t.end()
})

test('mutual exclusion', async t => {
  const { enqueue, getRunning, getQueued } = setup()
  const oneTwoThree = tasksFixture.slice(0, 3).map(enqueue)

  t.deepEqual(getRunning(), [0, 1])
  t.deepEqual(getQueued(), [2])

  await oneTwoThree[0]
  t.equal(getRunning().includes(2), true)

  t.end()
})

test('parallelize in order of enqueueing', async t => {
  const { enqueue, results, getRunning, getQueued } = setup()
  const promises = tasksFixture.map(enqueue)

  t.deepEqual(getRunning(), [0, 1])
  t.equal(getQueued().length, 3)
  await promises[0]

  t.deepEqual(getRunning().slice(-2), [2, 3])
  t.deepEqual(getQueued(), [4])
  await Promise.all(promises.slice(0, 4))

  t.deepEqual(getRunning(), [4])
  await Promise.all(promises)

  t.deepEqual(results, tasksFixture.map(t => t.name))
  t.end()
})

test('pause, resume, onEmpty', async t => {
  const { enqueue, results, getRunning, getQueued, q } = setup()
  const firstHalf = tasksFixture.slice(0, 3)
  const secondHalf = tasksFixture.slice(3)

  firstHalf.forEach(enqueue)

  const pausePromise = q.pause()
  secondHalf.forEach(enqueue)

  await pausePromise

  t.deepEqual(results, firstHalf.map(t => t.name))
  t.deepEqual(getRunning(), [])
  t.deepEqual(getQueued(), secondHalf.map(t => t.name))

  q.resume()
  await q.onEmpty()

  t.same(results, tasksFixture.map(t => t.name))
  t.equal(q.getRunning().length, 0)
  t.equal(q.getQueued().length, 0)

  t.end()
})
