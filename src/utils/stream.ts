import chalk from "chalk"

export function writeChunk(text: string): void {
  process.stdout.write(text)
}

export function writeLine(text: string = ""): void {
  console.log(text)
}

export function writePersonaHeader(name: string): void {
  process.stdout.write(chalk.bold.cyan(`${name}: `))
}

export function writeUserPrompt(): void {
  process.stdout.write(chalk.bold.green("you: "))
}

export function writeSystem(text: string): void {
  console.log(chalk.dim(text))
}

export function writeToolUse(toolName: string, input: string): void {
  console.log(chalk.dim(`  [using ${toolName}: ${input}]`))
}
