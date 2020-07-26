import { StateInterface, ActionInterface, VoteInterface, BalancesInterface, InputInterface, LockedBalanceInterface, LockedParamsInterface } from "./faces";

declare const ContractError: any;
declare const SmartWeave: any;

export function handle(state: StateInterface, action: ActionInterface) {

  const balances: BalancesInterface = state.balances;
  const lockedBalances: LockedBalanceInterface = state.lockedBalances;
  const votes: VoteInterface[] = state.votes;
  const input: InputInterface = action.input;
  const caller: string = action.caller;
  const voteLength: number = state.voteLength;
  const quorum: number = state.quorum;

  /** Transfer Function */
  if (input.function === 'transfer') {
    const target = input.target;
    const qty = input.qty;

    if (!Number.isInteger(qty)) {
      throw new ContractError('Invalid value for "qty". Must be an integer.');
    }

    if (!target) {
      throw new ContractError('No target specified.');
    }

    if (qty <= 0 || caller === target) {
      throw new ContractError('Invalid token transfer.');
    }

    if(!(caller in balances)) {
      throw new ContractError('Caller doesn\'t own any DAO balance.');
    }

    if (balances[caller] < qty) {
      throw new ContractError(`Caller balance not high enough to send ${qty} token(s)!`);
    }

    // Lower the token balance of the caller
    balances[caller] -= qty;

    if (target in balances) {
      // Wallet already exists in state, add new tokens
      balances[target] += qty;
    } else {
      // Wallet is new, set starting balance
      balances[target] = qty;
    }

    return { state };
  }

  /** Balance Function */
  if (input.function === 'balance') {
    const target = input.target || caller;
    
    if (typeof target !== 'string') {
      throw new ContractError('Must specificy target to get balance for.');
    }

    if (!(target in balances)) {
      throw new ContractError('Cannnot get balance, target does not exist.');
    }

    return { result: { target, balance: balances[target] } };
  }

  /** Lock System **/

  /** Lock Function */
  if(input.function === 'lock') {
    const qty = input.qty;
    const lockLength = input.lockLength;

    if(!Number.isInteger(qty) || qty <= 0) {
      throw new ContractError('Quantity must be a positive integer.');
    }

    if(!Number.isInteger(lockLength) || lockLength < state.lockMinLength || lockLength > state.lockMaxLength) {
      throw new ContractError(`lockLength is out of range. lockLength must be between ${state.lockMinLength} - ${state.lockMaxLength}.`);
    }

    const balance = balances[caller];
    if(isNaN(balance) || balance < qty) {
      throw new ContractError('Not enough balance.');
    }

    balances[caller] -= qty;
    if (caller in lockedBalances) {
      // Wallet already exists in state, add new tokens
      lockedBalances[caller].push({
        balance: qty,
        lockLength,
        start: SmartWeave.block.height
      });
    } else {
      // Wallet is new, set starting balance
      lockedBalances[caller] = [{
        balance: qty,
        lockLength,
        start: SmartWeave.block.height
      }];
    }

    return { state };
  }

  /** Unlock Function */
  if(input.function === 'unlock') {
    // After the time has passed for locked tokens, unlock them calling this function.
    if(caller in lockedBalances) {
      let i = lockedBalances[caller].length;
      while(i--) {
        const locked = lockedBalances[caller][i];
        if(SmartWeave.block.height >= (locked.start + locked.lockLength)) {
          // Unlock
          balances[caller] += locked.balance;
          lockedBalances[caller].splice(i, 1);
        }
      }
    }

    return { state };
  }

  /** LockedBalance Function */
  if(input.function === 'lockedBalance') {
    const target = input.target || caller;
    let balance = 0;

    if(target in lockedBalances) {
      const blockHeight = SmartWeave.block.height;
      const filtered = lockedBalances[target].filter(a => {
        return (blockHeight < (a.start + a.lockLength));
      });

      for(let i = 0, j = filtered.length; i < j; i++) {
        balance += filtered[i].balance;
      }
    }

    return { result: { target, balance} };
  }

  /** Propose Function */
  if (input.function === 'propose') {
    const voteType = input.type;

    const note = input.note;
    if(typeof note !== 'string') {
      throw new ContractError('Note format not recognized.');
    }

    if(!(caller in lockedBalances)) {
      throw new ContractError('caller need to have locked balances.');
    }
    
    const hasBalance = (lockedBalances[caller] && !!lockedBalances[caller].filter(a => a.balance > 0).length);
    if(!hasBalance) {
      throw new ContractError('Caller doesn\'t have any locked balance.');
    }

    let vote: VoteInterface = {
      status: 'active',
      type: voteType,
      note,
      yays: 0,
      nays: 0,
      voted: [],
      start: SmartWeave.block.height
    };

    if (voteType === 'mint' || voteType === 'mintLocked') {
      const recipient = input.recipient;
      const qty = input.qty;

      if (!recipient) {
        throw new ContractError('No recipient specified');
      }

      if (!Number.isInteger(qty) || qty <= 0) {
        throw new ContractError('Invalid value for "qty". Must be a positive integer.');
      }

      let lockLength = {};
      if(input.lockLength) {
        if(!Number.isInteger(input.lockLength)) {
          throw new ContractError('Invalid value for "lockedLength". Must be a positive integer.');
        }

        lockLength = { lockLength: input.lockLength };
      }
      
      Object.assign(vote, {
        recipient,
        qty: qty,
      }, lockLength);

      votes.push(vote);
    } else if (voteType === 'set') {
      if (typeof input.key !== "string") {
        throw new ContractError('Data type of key not supported.');
      }

      // TODO: Add validators
      if(input.key === 'quorum') {
        if(isNaN(input.value) || input.value < 0.01 || input.value > 0.99) {
          throw new ContractError('Quorum must be between 0.01 and 0.99.');
        }
      } else if(input.key === 'support') {
        if(isNaN(input.value) || input.value < 0.01 || input.value > 0.99) {
          throw new ContractError('Support must be between 0.01 and 0.99.');
        }
      } else if(input.key === 'lockMinLength') {
        if(isNaN(input.value) || input.value < 1 || input.value >= state.lockMaxLength) {
          throw new ContractError('lockMinLength cannot be less than 1 and cannot be equal or greater than lockMaxLength.');
        }
      } else if(input.key === 'lockMaxLength') {
        if(isNaN(input.value) || input.value <= state.lockMinLength) {
          throw new ContractError('lockMaxLength cannot be less than or equal to lockMinLength.');
        }
      } else {
        // Reject other keys changes
        throw new ContractError('This DAO option cannot be changed.');
      }

      Object.assign(vote, {
        'key': input.key,
        'value': input.value
      });
      
      votes.push(vote);
    } else if (voteType === 'indicative') {
      votes.push(vote);
    } else {
      throw new ContractError('Invalid vote type.');
    }

    return { state };
  }

  /** Vote Function */
  if (input.function === 'vote') {
    const id = input.id;
    const cast = input.cast;

    if (!Number.isInteger(id)) {
      throw new ContractError('Invalid value for "id". Must be an integer.');
    }

    const vote = votes[id];
    
    let voterBalance = 0;
    if(caller in lockedBalances) {
      for(let i = 0, j = lockedBalances[caller].length; i < j; i++) {
        const locked = lockedBalances[caller][i];

        if(SmartWeave.block.height < (locked.start + locked.lockLength)) {
          voterBalance += (locked.balance * locked.lockLength);
        }
      }
    }
    if (voterBalance <= 0) {
      throw new ContractError('Caller does not have locked balance.');
    }

    if (vote.voted.includes(caller)) {
      throw new ContractError('Caller has already voted.');
    }

    if (SmartWeave.block.height >= (vote.start + voteLength)) {
      throw new ContractError('Vote has already concluded.');
    }

    if (cast == 'yay') {
      vote.yays += voterBalance;
    } else if (cast == 'nay') {
      vote.nays += voterBalance;
    } else {
      throw new ContractError('Vote cast type unrecognised.');
    }

    vote.voted.push(caller);
    return { state };
  }

  /** Finalize Function */
  if (input.function === 'finalize') {
    const id: string = input.id;
    const vote: VoteInterface = votes[id];
    const qty: number = vote.qty;

    if (SmartWeave.block.height < (vote.start + voteLength)) {
      throw new ContractError('Vote has not yet concluded.');
    }

    if (vote.status !== 'active') {
      throw new ContractError('Vote is not active.');
    }

    // TODO: Check this total supply and quorum.
    let totalSupply: number = Object.values(state.balances).reduce((a, b) => a + b, 0);
    const lockedAccounts = Object.keys(state.lockedBalances);
    for(let i = 0, j = lockedAccounts.length; i < j; i++) {
      const locked = state.lockedBalances[lockedAccounts[i]];
      totalSupply += locked.map(a => a.balance).reduce((a, b) => a + b, 0);
    }

    if((totalSupply * quorum) > (vote.yays + vote.nays)) {
      vote.status = 'quorumFailed';
      return state;
    }

    if (vote.yays > vote.nays) {
      vote.status = 'passed';

      if (vote.type === 'mint') {
        if (vote.recipient in balances) {
          // Wallet already exists in state, add new tokens
          balances[vote.recipient] += qty;
        } else {
          // Wallet is new, set starting balance
          balances[vote.recipient] = qty;
        }

      } else if(vote.type === 'mintLocked') {
        const locked: LockedParamsInterface = {
          balance: qty,
          start: SmartWeave.block.height,
          lockLength: vote.lockLength
        };

        if(vote.recipient in lockedBalances) {
          // Existing account
          lockedBalances[vote.recipient].push(locked);
        } else {
          // New locked account
          lockedBalances[vote.recipient] = [locked];
        }
      } else if (vote.type === 'set') {
        state[vote.key] = vote.value;
      }

    } else {
      vote.status = 'failed';
    }

    return { state };
  }

  throw new ContractError(`No function supplied or function not recognised: "${input.function}"`);
}