'use client'

// Per-type Design previews. Every screen is built from theme tokens only (it
// renders inside SessionTheme) and from the preview plan's content: the
// session's real question/options/image/Clue when they exist, samples
// otherwise, and always-sample people. Screens that live inline in the
// presenter page are lookalikes built from the same tokens and classes.

import PollQuestion from '@/components/PollQuestion'
import QuizQuestion from '@/components/QuizQuestion'
import ResultsChart from '@/components/ResultsChart'
import Leaderboard from '@/components/Leaderboard'
import { RoundBoard } from '@/components/RoundBoard'
import WheelArt from '@/components/WheelArt'
import SessionLogo from '@/components/SessionLogo'
import { wheelPalette } from '@/lib/wheelPalette'

const noop = () => {}
const noopAsync = async () => {}

function PreviewHeader({ theme, title, subtitle }) {
  return (
    <div className="flex items-center gap-4 border-b border-border bg-card px-6 py-4">
      <SessionLogo theme={theme} className="h-9 shrink-0" />
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-bold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

// A phone-width screen centered in the panel, as the attendee sees it.
function PhoneFrame({ theme, title, subtitle, children }) {
  return (
    <div className="min-h-[520px] bg-gradient-to-br from-background to-muted">
      <PreviewHeader theme={theme} title={title} subtitle={subtitle} />
      <div className="mx-auto max-w-md p-6">{children}</div>
    </div>
  )
}

function Stage({ theme, title, subtitle, children, footer = null }) {
  return (
    <div className="flex min-h-[520px] flex-col">
      <PreviewHeader theme={theme} title={title} subtitle={subtitle} />
      <div className="flex-1 px-8 py-10">{children}</div>
      {footer}
    </div>
  )
}

function OptionRow({ index, text, state = 'plain' }) {
  const correct = state === 'correct'
  const dim = state === 'dim'
  return (
    <div
      className={`flex items-center rounded-xl border px-5 py-4 text-lg ${
        correct
          ? 'border-primary bg-primary text-white'
          : `border-border bg-card text-foreground ${dim ? 'opacity-50' : ''}`
      }`}
    >
      <span
        className={`mr-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display ${
          correct ? 'bg-white/20 text-white' : 'bg-primary/15 text-accent'
        }`}
      >
        {String.fromCharCode(65 + index)}
      </span>
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {correct && <span className="ml-3 text-sm font-semibold">Correct</span>}
    </div>
  )
}

function ImageBox({ imageUrl, className = '' }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-uploaded storage URL
      <img src={imageUrl} alt="" className={`w-full rounded-xl border border-border object-contain bg-muted ${className}`} />
    )
  }
  return (
    <div
      className={`flex w-full items-center justify-center rounded-xl border border-border bg-gradient-to-br from-primary/30 to-accent/30 text-sm text-muted-foreground ${className}`}
    >
      Sample image
    </div>
  )
}

// ---- Poll ----------------------------------------------------------------

function VotingPreview({ theme, title, content }) {
  return (
    <PhoneFrame theme={theme} title={title} subtitle="Question 1 of 3">
      <PollQuestion question={{ text: content.question.text }} options={content.options} onVote={noopAsync} />
    </PhoneFrame>
  )
}

function PresenterPreview({ theme, title, content }) {
  return (
    <Stage
      theme={theme}
      title={title}
      subtitle="Question 1 of 3"
      footer={
        <div className="flex justify-end border-t border-border px-6 py-4">
          <span className="rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-white">Next question →</span>
        </div>
      }
    >
      <p className="text-sm font-semibold uppercase tracking-widest text-accent">Question 1 of 3</p>
      <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-foreground">{content.question.text}</h2>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {content.options.map((option, i) => (
          <OptionRow key={option.id} index={i} text={option.text} />
        ))}
      </div>
    </Stage>
  )
}

function ResultsPreview({ theme, title, content }) {
  const counts = content.options.reduce((acc, o, i) => {
    acc[o.id] = [12, 7, 3, 2][i] ?? 1
    return acc
  }, {})
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return (
    <div className="p-6">
      <SessionLogo theme={theme} className="mb-4 h-10" />
      <h2 className="font-display text-2xl font-bold text-foreground">Results: {title}</h2>
      <p className="mt-1 text-muted-foreground">{total} votes · {content.question.text}</p>
      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <ResultsChart options={content.options} voteCounts={counts} live={false} />
      </div>
    </div>
  )
}

// ---- Quiz ----------------------------------------------------------------

function AnsweringPreview({ theme, title, content }) {
  return (
    <PhoneFrame theme={theme} title={title} subtitle="Question 1 of 3">
      {/* No id and no time limit: the question clock stays inactive. */}
      <QuizQuestion question={{ text: content.question.text }} options={content.options} onLock={noop} />
    </PhoneFrame>
  )
}

function QuestionPreview({ theme, title, content }) {
  return (
    <Stage theme={theme} title={title} subtitle="Question 1 of 3">
      <p className="text-sm font-semibold uppercase tracking-widest text-accent">Question 1 of 3</p>
      <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-foreground">{content.question.text}</h2>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {content.options.map((option, i) => (
          <OptionRow key={option.id} index={i} text={option.text} />
        ))}
      </div>
    </Stage>
  )
}

function RevealPreview({ theme, title, content }) {
  return (
    <Stage theme={theme} title={title} subtitle="Answer revealed">
      <p className="text-sm font-semibold uppercase tracking-widest text-accent">The answer</p>
      <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-foreground">{content.question.text}</h2>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {content.options.map((option, i) => (
          <OptionRow
            key={option.id}
            index={i}
            text={option.text}
            state={option.id === content.correctOptionId ? 'correct' : 'dim'}
          />
        ))}
      </div>
    </Stage>
  )
}

function LeaderboardPreview({ theme, title, content }) {
  return (
    <Stage theme={theme} title={title} subtitle="Leaderboard">
      <h2 className="mb-6 font-display text-3xl font-bold text-foreground">Leaderboard</h2>
      <div className="mx-auto max-w-xl">
        <Leaderboard entries={content.people.leaderboard} />
      </div>
    </Stage>
  )
}

function RoundBoardPreview({ theme, title, content }) {
  return (
    <Stage theme={theme} title={title} subtitle="Round board">
      <h2 className="mb-6 font-display text-3xl font-bold text-foreground">Got it right, fastest first</h2>
      <div className="mx-auto max-w-xl">
        <RoundBoard entries={content.people.round} />
      </div>
    </Stage>
  )
}

// ---- Comments -------------------------------------------------------------

function CommentingPreview({ theme, title, content }) {
  return (
    <PhoneFrame theme={theme} title={title} subtitle="Image 1 of 3">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-lg">
        <ImageBox imageUrl={content.imageUrl} className="h-48" />
        <p className="mt-4 font-display text-xl font-bold text-foreground">{content.question.text}</p>
        <div className="mt-4 h-24 rounded-lg border border-border px-4 py-3 text-foreground/50">Add your comment…</div>
        <span className="mt-4 block rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-center font-semibold text-white">
          Post comment
        </span>
      </div>
    </PhoneFrame>
  )
}

function ImagePreview({ theme, title, content }) {
  return (
    <Stage theme={theme} title={title} subtitle="Image 1 of 3">
      <p className="text-sm font-semibold uppercase tracking-widest text-accent">Image 1 of 3</p>
      <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-foreground">{content.question.text}</h2>
      <ImageBox imageUrl={content.imageUrl} className="mt-6 h-72" />
    </Stage>
  )
}

function WallPreview({ theme, title, content }) {
  return (
    <Stage theme={theme} title={title} subtitle="Comment wall">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ImageBox imageUrl={content.imageUrl} className="h-64" />
        <ul className="space-y-3">
          {content.people.comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-foreground">{c.body}</p>
              <p className="mt-1 text-xs font-semibold text-accent">{c.name}</p>
            </li>
          ))}
        </ul>
      </div>
    </Stage>
  )
}

// ---- Wheel ----------------------------------------------------------------

function JoiningPreview({ theme, title }) {
  return (
    <PhoneFrame theme={theme} title={title} subtitle="Wheel of Fortune">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="font-display text-2xl font-bold text-foreground">Join this session</h1>
        <p className="mt-2 text-muted-foreground">Enter your name to go on the wheel.</p>
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-border px-4 py-3 text-foreground/50">Your name</div>
          <span className="block rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-center font-semibold text-white">
            Join the wheel
          </span>
        </div>
      </div>
    </PhoneFrame>
  )
}

function WheelPreview({ theme, title, content, picked }) {
  const palette = wheelPalette(theme)
  const entries = content.people.wheelEntries
  const landed = entries[2]
  return (
    <div className="flex min-h-[520px] flex-col bg-background">
      <PreviewHeader theme={theme} title={title} subtitle="Wheel of Fortune" />
      <div className="relative flex flex-1 items-center justify-center px-6 py-6">
        <div className={`relative aspect-square w-full max-w-[22rem] ${picked ? '[&_.wheel-bulb]:opacity-100' : ''}`}>
          <WheelArt
            entries={entries}
            palette={palette}
            logoUrl={theme.logoUrl || null}
            pickedId={picked ? landed.id : null}
            waiting={!picked}
            hasPick={Boolean(picked)}
          />
          {!picked && (
            <p className="absolute left-1/2 top-[64%] -translate-x-1/2 whitespace-nowrap rounded-full bg-background/85 px-5 py-2 font-display text-sm font-bold uppercase tracking-wider text-foreground">
              Waiting for entries
            </p>
          )}
        </div>
      </div>
      {picked && (
        <div className="flex h-24 items-center justify-center border-y border-t-primary border-b-border bg-card/90 px-8 text-center">
          <p className="font-display text-4xl font-bold leading-tight text-foreground">{landed.label}</p>
        </div>
      )}
    </div>
  )
}

// ---- Treasure hunt ----------------------------------------------------------

function CluePreview({ theme, title, content }) {
  const { clue } = content
  return (
    <div className="flex min-h-[520px] items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
        <SessionLogo theme={theme} className="mx-auto mb-4 h-10" />
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">{title} · Clue #1</p>
        <p className="mt-4 whitespace-pre-wrap font-display text-2xl font-bold text-foreground">{clue.message}</p>
        {clue.choices.length > 0 && (
          <div className="mt-6 space-y-3">
            {clue.choices.map((choice, i) => (
              <span
                key={i}
                className={`block w-full rounded-xl border px-4 py-3 text-base font-semibold ${
                  i === 0
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-card text-foreground opacity-50'
                }`}
              >
                {choice.label || `Choice ${i + 1}`}
              </span>
            ))}
            <p className="mt-4 whitespace-pre-wrap rounded-xl bg-muted p-4 font-display text-xl font-bold text-foreground">
              {clue.choices[0].reveal || 'The reveal text appears here.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Dispatch ---------------------------------------------------------------

export default function PreviewFor({ tab, theme, title, content }) {
  const props = { theme, title, content }
  switch (tab) {
    case 'voting': return <VotingPreview {...props} />
    case 'presenter': return <PresenterPreview {...props} />
    case 'results': return <ResultsPreview {...props} />
    case 'answering': return <AnsweringPreview {...props} />
    case 'question': return <QuestionPreview {...props} />
    case 'reveal': return <RevealPreview {...props} />
    case 'leaderboard': return <LeaderboardPreview {...props} />
    case 'round': return <RoundBoardPreview {...props} />
    case 'commenting': return <CommentingPreview {...props} />
    case 'image': return <ImagePreview {...props} />
    case 'wall': return <WallPreview {...props} />
    case 'joining': return <JoiningPreview {...props} />
    case 'wheel': return <WheelPreview {...props} picked={false} />
    case 'pick': return <WheelPreview {...props} picked />
    case 'clue': return <CluePreview {...props} />
    default: return null
  }
}
