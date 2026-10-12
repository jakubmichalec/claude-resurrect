import { describe, expect, it } from 'vitest';
import {
  TASK_LABEL,
  resurrectTask,
  withResurrectTask,
  withoutResurrectTask,
} from '../src/zed-task';

const foreign = { label: 'npm test', command: 'npm', args: ['test'] };

describe('resurrectTask', () => {
  it('opens its own tab and carries the chosen mode', () => {
    const task = resurrectTask('always');

    expect(task).toMatchObject({
      label: TASK_LABEL,
      use_new_terminal: true,
      reveal: 'always',
      reveal_target: 'center',
    });
    expect(resurrectTask('always', 'dock').reveal_target).toBe('dock');
    expect(task.args[1]).toContain('next --mode always');
    expect(resurrectTask('ask').args[1]).toContain('pick');
    expect(task.args[1]).toContain('exec "${SHELL:-sh}" -il');
    expect(task.env.CLAUDE_RESURRECT_SKIP).toBe('1');
  });
});

describe('withResurrectTask', () => {
  it('adds the task once and replaces an earlier copy', () => {
    const first = withResurrectTask([foreign], resurrectTask('ask'));
    const second = withResurrectTask(first, resurrectTask('always'));

    expect(second).toHaveLength(2);
    expect(second[0]).toEqual(foreign);
    expect(second[1]).toMatchObject({ label: TASK_LABEL });
  });
});

describe('withoutResurrectTask', () => {
  it('removes only our task', () => {
    expect(withoutResurrectTask([foreign, resurrectTask('ask')])).toEqual([foreign]);
  });
});
