export type StepState = 'pending' | 'active' | 'done' | 'failed'

export interface Step {
  label: string
  hint?: string
  state: StepState
}

const ICON: Record<StepState, string> = {
  pending: '',
  active: '',
  done: '✓',
  failed: '×',
}

/** Vertical pipeline timeline: Uploading → Detecting → Weather → Report → PDF. */
export default function ProgressStepper({ steps }: { steps: Step[] }) {
  return (
    <div>
      {steps.map((step, i) => (
        <div key={step.label}>
          <div className="step" data-state={step.state}>
            <span className="step-dot">{ICON[step.state] || i + 1}</span>
            <div className="min-w-0">
              <p
                className="text-sm font-medium"
                style={{
                  color:
                    step.state === 'pending'
                      ? 'var(--faint)'
                      : step.state === 'failed'
                        ? 'var(--danger)'
                        : 'var(--text)',
                }}
              >
                {step.label}
              </p>
              {step.hint && (
                <p className="text-xs" style={{ color: 'var(--faint)' }}>
                  {step.hint}
                </p>
              )}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className="step-line" data-filled={step.state === 'done'} />
          )}
        </div>
      ))}
    </div>
  )
}
