import { Injectable } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import asyncPool from "tiny-async-pool";
import Papa from 'papaparse';
import memoize from 'memoizee';

const processCsvWithPapa = async (filePath: string): Promise<any[]> => {
  return new Promise((resolve, reject) => {

    const startTime = performance.now();

    Papa.parse(fs.createReadStream(filePath), {
      header: false,
      columns: null,
      complete: function (results) {
        const duration = performance.now() - startTime;
        console.log(`Finished processing ${filePath}. Total records: ${results.data.length}. Duration: ${duration.toFixed(2)} ms`);
        resolve(results.data);
      }
    })
  })
}

const memoizedCsvProcess = memoize(processCsvWithPapa, {
  maxAge: 1000 * 60 * 60, // Cache for 1 hour
  promise: true,
})

@Injectable()
export class ReportsService {
  private readonly tmpDir = 'tmp';
  private states = {
    accounts: 'idle',
    yearly: 'idle',
    fs: 'idle',
  };

  private readonly parallelLimit = 30; // Adjust this value based on your system's capabilities

  state(scope: string) {
    return this.states[scope];
  }

  readFilesInTmpFolder() {
    return fs.readdirSync('tmp').filter((file) => file.endsWith('.csv'));
  }

  async accounts() {
    this.states.accounts = 'starting';
    const start = performance.now();
    const outputFile = 'out/accounts.csv';
    const accountBalances: Record<string, number> = {};
    const csvFilesInFolder = this.readFilesInTmpFolder();
    console.log(`Processing ${csvFilesInFolder.length} CSV files with a parallel limit of ${this.parallelLimit}`);

    for await (const lines of asyncPool(this.parallelLimit, csvFilesInFolder,
      (file) => memoizedCsvProcess(path.join(this.tmpDir, file)))) {
      for (const line of lines) {
        const [, account, , debit, credit] = line;
        if (!accountBalances[account]) {
          accountBalances[account] = 0;
        }
        accountBalances[account] +=
          parseFloat(String(debit || 0)) - parseFloat(String(credit || 0));
      }
    }

    const output = ['Account,Balance'];
    for (const [account, balance] of Object.entries(accountBalances)) {
      output.push(`${account},${balance.toFixed(2)}`);
    }
    await fs.promises.writeFile(outputFile, output.join('\n'));
    this.states.accounts = `finished in ${((performance.now() - start) / 1000).toFixed(2)}`;
  }

  async yearly() {
    this.states.yearly = 'starting';
    const start = performance.now();
    const outputFile = 'out/yearly.csv';
    const csvFilesInFolder = this.readFilesInTmpFolder();
    const cashByYear: Record<string, number> = {};

    for await (const lines of asyncPool(this.parallelLimit, csvFilesInFolder, (file) => memoizedCsvProcess(path.join(this.tmpDir, file)))) {
      for (const line of lines) {
        const [date, account, , debit, credit] = line;
        if (account === 'Cash') {
          const year = new Date(date).getFullYear();
          if (!cashByYear[year]) {
            cashByYear[year] = 0;
          }
          cashByYear[year] +=
            parseFloat(String(debit || 0)) - parseFloat(String(credit || 0));
        }
      }
    }

    const output = ['Financial Year,Cash Balance'];
    Object.keys(cashByYear)
      .sort()
      .forEach((year) => {
        output.push(`${year},${cashByYear[year].toFixed(2)}`);
      });
    await fs.promises.writeFile(outputFile, output.join('\n'));
    this.states.yearly = `finished in ${((performance.now() - start) / 1000).toFixed(2)}`;
  }

  async financialStatement() {
    this.states.fs = 'starting';
    const start = performance.now();
    const outputFile = 'out/fs.csv';
    const csvFilesInFolder = this.readFilesInTmpFolder();
    const categories = {
      'Income Statement': {
        Revenues: ['Sales Revenue'],
        Expenses: [
          'Cost of Goods Sold',
          'Salaries Expense',
          'Rent Expense',
          'Utilities Expense',
          'Interest Expense',
          'Tax Expense',
        ],
      },
      'Balance Sheet': {
        Assets: [
          'Cash',
          'Accounts Receivable',
          'Inventory',
          'Fixed Assets',
          'Prepaid Expenses',
        ],
        Liabilities: [
          'Accounts Payable',
          'Loan Payable',
          'Sales Tax Payable',
          'Accrued Liabilities',
          'Unearned Revenue',
          'Dividends Payable',
        ],
        Equity: ['Common Stock', 'Retained Earnings'],
      },
    };
    const balances: Record<string, number> = {};
    for (const section of Object.values(categories)) {
      for (const group of Object.values(section)) {
        for (const account of group) {
          balances[account] = 0;
        }
      }
    }
    for await (const lines of asyncPool(this.parallelLimit, csvFilesInFolder,
      (file) => memoizedCsvProcess(path.join(this.tmpDir, file)))) {
      for (const line of lines) {
        const [, account, , debit, credit] = line;

        if (balances.hasOwnProperty(account)) {
          balances[account] +=
            parseFloat(String(debit || 0)) - parseFloat(String(credit || 0));
        }
      }
    }


    const output: string[] = [];
    output.push('Basic Financial Statement');
    output.push('');
    output.push('Income Statement');
    let totalRevenue = 0;
    let totalExpenses = 0;
    for (const account of categories['Income Statement']['Revenues']) {
      const value = balances[account] || 0;
      output.push(`${account},${value.toFixed(2)}`);
      totalRevenue += value;
    }
    for (const account of categories['Income Statement']['Expenses']) {
      const value = balances[account] || 0;
      output.push(`${account},${value.toFixed(2)}`);
      totalExpenses += value;
    }
    output.push(`Net Income,${(totalRevenue - totalExpenses).toFixed(2)}`);
    output.push('');
    output.push('Balance Sheet');
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    output.push('Assets');
    for (const account of categories['Balance Sheet']['Assets']) {
      const value = balances[account] || 0;
      output.push(`${account},${value.toFixed(2)}`);
      totalAssets += value;
    }
    output.push(`Total Assets,${totalAssets.toFixed(2)}`);
    output.push('');
    output.push('Liabilities');
    for (const account of categories['Balance Sheet']['Liabilities']) {
      const value = balances[account] || 0;
      output.push(`${account},${value.toFixed(2)}`);
      totalLiabilities += value;
    }
    output.push(`Total Liabilities,${totalLiabilities.toFixed(2)}`);
    output.push('');
    output.push('Equity');
    for (const account of categories['Balance Sheet']['Equity']) {
      const value = balances[account] || 0;
      output.push(`${account},${value.toFixed(2)}`);
      totalEquity += value;
    }
    output.push(
      `Retained Earnings (Net Income),${(totalRevenue - totalExpenses).toFixed(2)}`,
    );
    totalEquity += totalRevenue - totalExpenses;
    output.push(`Total Equity,${totalEquity.toFixed(2)}`);
    output.push('');
    output.push(
      `Assets = Liabilities + Equity, ${totalAssets.toFixed(2)} = ${(totalLiabilities + totalEquity).toFixed(2)}`,
    );
    await fs.promises.writeFile(outputFile, output.join('\n'));
    this.states.fs = `finished in ${((performance.now() - start) / 1000).toFixed(2)}`;
  }
}
