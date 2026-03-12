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

const SPINNER_FRAMES = [".", "..", "..."]
const SPINNER_INTERVAL = 400

export class StatusLine {
  private timer: ReturnType<typeof setInterval> | null = null
  private frame = 0
  private currentText = ""

  show(text: string): void {
    this.clear()
    this.currentText = text
    this.frame = 0
    this.render()
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length
      this.render()
    }, SPINNER_INTERVAL)
  }

  clear(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.currentText) {
      process.stdout.write("\r\x1b[K")
      this.currentText = ""
    }
  }

  private render(): void {
    const display = chalk.dim(`${this.currentText}${SPINNER_FRAMES[this.frame]}`)
    process.stdout.write(`\r\x1b[K${display}`)
  }
}
