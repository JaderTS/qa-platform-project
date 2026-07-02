import { test, expect } from '@playwright/test';

test.describe('Todos API', () => {
  test('GET /todos returns 200 todos', async ({ request }) => {
    const response = await request.get('/todos');
    expect(response.status()).toBe(200);

    const todos = await response.json();
    expect(todos).toHaveLength(200);
    expect(todos[0]).toMatchObject({
      userId: expect.any(Number),
      id: expect.any(Number),
      title: expect.any(String),
      completed: expect.any(Boolean),
    });
  });

  test('GET /todos?userId=&completed= filters todos', async ({ request }) => {
    const response = await request.get('/todos?userId=1&completed=true');
    expect(response.status()).toBe(200);

    const todos = await response.json();
    expect(todos.length).toBeGreaterThan(0);
    for (const todo of todos) {
      expect(todo.userId).toBe(1);
      expect(todo.completed).toBe(true);
    }
  });

  test('POST /todos creates a new todo', async ({ request }) => {
    const response = await request.post('/todos', {
      data: { userId: 1, title: 'write api tests', completed: false },
    });
    expect(response.status()).toBe(201);

    const created = await response.json();
    expect(created).toMatchObject({ userId: 1, title: 'write api tests', completed: false });
  });
});
