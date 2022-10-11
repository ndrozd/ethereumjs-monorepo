import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { Address, toBuffer } from '@ethereumjs/util'
import * as tape from 'tape'

import {
  AccessListEIP2930Transaction,
  FeeMarketEIP1559Transaction,
  Transaction,
  TransactionFactory,
} from '../src'

import type {
  AccessListEIP2930ValuesArray,
  FeeMarketEIP1559ValuesArray,
  TxValuesArray,
} from '../src'
import type { AddressLike, BigIntLike, BufferLike } from '@ethereumjs/util'

// @returns: Array with subtypes of the AddressLike type for a given address
function generateAddressLikeValues(address: string): AddressLike[] {
  return [address, toBuffer(address), new Address(toBuffer(address))]
}

// @returns: Array with subtypes of the BigIntLike type for a given number
function generateBigIntLikeValues(value: number): BigIntLike[] {
  return [value, BigInt(value), `0x${value.toString(16)}`, toBuffer(value)]
}

// @returns: Array with subtypes of the BufferLike type for a given string
function generateBufferLikeValues(value: string): BufferLike[] {
  return [value, toBuffer(value)]
}

interface GenerateCombinationsArgs {
  options: { [x: string]: any }
  optionIndex?: number
  results?: { [x: string]: any }[]
  current?: { [x: string]: any }
}

export function generateCombinations({
  options,
  optionIndex = 0,
  results = [],
  current = {},
}: GenerateCombinationsArgs) {
  const allKeys = Object.keys(options)
  const optionKey = allKeys[optionIndex]
  const values = options[optionKey]

  for (let i = 0; i < values.length; i++) {
    current[optionKey] = values[i]

    if (optionIndex + 1 < allKeys.length) {
      generateCombinations({ options, optionIndex: optionIndex + 1, results, current })
    } else {
      // Clone the object
      const res = { ...current }
      results.push(res)
    }
  }

  return results
}

// Deterministic pseudorandom number generator
function mulberry32(seed: number) {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function getRandomSubarray<TArrayItem>(array: TArrayItem[], size: number) {
  const shuffled = array.slice(0)
  let seed = 1559
  let index: number
  let length = array.length
  let temp: TArrayItem
  while (length > 0) {
    index = Math.floor((length + 1) * mulberry32(seed))
    temp = shuffled[index]
    shuffled[index] = shuffled[length]
    shuffled[length] = temp
    seed++
    length--
  }
  return shuffled.slice(0, size)
}

const baseTxValues = {
  data: generateBufferLikeValues('0x65'),
  gasLimit: generateBigIntLikeValues(100000),
  nonce: generateBigIntLikeValues(0),
  to: generateAddressLikeValues('0x0000000000000000000000000000000000000000'),
  r: generateBigIntLikeValues(100),
  s: generateBigIntLikeValues(100),
  value: generateBigIntLikeValues(10),
}

const legacyTxValues = {
  gasPrice: generateBigIntLikeValues(100),
}

const accessListEip2930TxValues = {
  chainId: generateBigIntLikeValues(4),
}

const eip1559TxValues = {
  maxFeePerGas: generateBigIntLikeValues(100),
  maxPriorityFeePerGas: generateBigIntLikeValues(50),
}

tape('[Transaction Input Values]', function (t) {
  t.test('Legacy Transaction Values', function (st) {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Homestead })
    const options = { ...baseTxValues, ...legacyTxValues, type: '0' }
    const legacyTxData = generateCombinations({
      options,
    })
    const randomSample = getRandomSubarray(legacyTxData, 100)
    for (const txData of randomSample) {
      const tx = Transaction.fromTxData(txData, { common })
      t.throws(() => tx.hash(), 'tx.hash() throws if tx is unsigned')
    }
    st.end()
  })

  t.test('EIP-1559 Transaction Values', function (st) {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
    const options = {
      ...baseTxValues,
      ...accessListEip2930TxValues,
      ...eip1559TxValues,
      type: '2',
    }
    const eip1559TxData = generateCombinations({
      options,
    })
    const randomSample = getRandomSubarray(eip1559TxData, 100)

    for (const txData of randomSample) {
      const tx = Transaction.fromTxData(txData, { common })
      t.throws(() => tx.hash(), 'tx.hash() should throw if unsigned')
    }
    st.end()
  })
})

tape('[Invalid Array Input values]', (t) => {
  const txTypes = [0x0, 0x1, 0x2]
  for (const signed of [false, true]) {
    for (const txType of txTypes) {
      let tx = TransactionFactory.fromTxData({ type: txType })
      if (signed) {
        tx = tx.sign(Buffer.from('42'.repeat(32), 'hex'))
      }
      const rawValues = tx.raw()
      for (let x = 0; x < rawValues.length; x++) {
        rawValues[x] = <any>[1, 2, 3]
        switch (txType) {
          case 0:
            t.throws(() => Transaction.fromValuesArray(rawValues as TxValuesArray))
            break
          case 1:
            t.throws(() =>
              AccessListEIP2930Transaction.fromValuesArray(
                rawValues as AccessListEIP2930ValuesArray
              )
            )
            break
          case 2:
            t.throws(() =>
              FeeMarketEIP1559Transaction.fromValuesArray(rawValues as FeeMarketEIP1559ValuesArray)
            )
            break
        }
      }
    }
  }
  t.end()
})

tape('[Invalid Access Lists]', (t) => {
  const txTypes = [0x1, 0x2]
  const invalidAccessLists = [
    [[]], // does not have an address and does not have slots
    [[[], []]], // the address is an array
    [['0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae']], // there is no storage slot array
    [
      [
        '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae',
        ['0x0000000000000000000000000000000000000000000000000000000000000003', []],
      ],
    ], // one of the slots is an array
    [
      [
        '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae',
        ['0x0000000000000000000000000000000000000000000000000000000000000003'],
        '0xab',
      ],
    ], // extra field
    [
      '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae',
      ['0x0000000000000000000000000000000000000000000000000000000000000003'],
    ], // account/slot needs to be encoded in a deeper array layer
  ]
  for (const signed of [false, true]) {
    for (const txType of txTypes) {
      for (const invalidAccessListItem of invalidAccessLists) {
        let tx: any
        try {
          tx = TransactionFactory.fromTxData({
            type: txType,
            accessList: <any>invalidAccessListItem,
          })
          if (signed) {
            tx = tx.sign(Buffer.from('42'.repeat(32), 'hex'))
          }
          t.fail('did not fail on `fromTxData`')
        } catch (e: any) {
          t.pass('failed ok on decoding in `fromTxData`')
          tx = TransactionFactory.fromTxData({ type: txType })
          if (signed) {
            tx = tx.sign(Buffer.from('42'.repeat(32), 'hex'))
          }
        }
        const rawValues = tx!.raw()

        if (txType === 1 && rawValues[7].length === 0) {
          rawValues[7] = invalidAccessListItem
        } else if (txType === 2 && rawValues[8].length === 0) {
          rawValues[8] = invalidAccessListItem
        }

        switch (txType) {
          case 1:
            t.throws(() =>
              AccessListEIP2930Transaction.fromValuesArray(
                rawValues as AccessListEIP2930ValuesArray
              )
            )
            break
          case 2:
            t.throws(() =>
              FeeMarketEIP1559Transaction.fromValuesArray(rawValues as FeeMarketEIP1559ValuesArray)
            )
            break
        }
      }
    }
  }
  t.end()
})
