import { test, expect } from '@playwright/test';

test.describe('Posts API', () => {
  test('GET /posts returns a list of 100 posts', async ({ request }) => {
    const response = await request.get('/posts');
    expect(response.status()).toBe(200);

    const posts = await response.json();
    expect(Array.isArray(posts)).toBe(true);
    expect(posts).toHaveLength(100);
    expect(posts[0]).toMatchObject({
      userId: expect.any(Number),
      id: expect.any(Number),
      title: expect.any(String),
      body: expect.any(String),
    });
  });

  test('GET /posts/:id returns a single post', async ({ request }) => {
    const response = await request.get('/posts/1');
    expect(response.status()).toBe(200);

    const post = await response.json();
    expect(post.id).toBe(1);
    expect(post).toHaveProperty('title');
    expect(post).toHaveProperty('body');
  });

  test('GET /posts/:id returns 404 for a non-existent post', async ({ request }) => {
    const response = await request.get('/posts/9999');
    expect(response.status()).toBe(404);
  });

  test('GET /posts?userId= filters posts by user', async ({ request }) => {
    const response = await request.get('/posts?userId=1');
    expect(response.status()).toBe(200);

    const posts = await response.json();
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.userId).toBe(1);
    }
  });

  test('GET /posts/:id/comments returns comments for a post', async ({ request }) => {
    const response = await request.get('/posts/1/comments');
    expect(response.status()).toBe(200);

    const comments = await response.json();
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBeGreaterThan(0);
    for (const comment of comments) {
      expect(comment.postId).toBe(1);
    }
  });

  test('POST /posts creates a new post', async ({ request }) => {
    const response = await request.post('/posts', {
      data: { title: 'qa-platform', body: 'automated test post', userId: 1 },
    });
    expect(response.status()).toBe(201);

    const created = await response.json();
    expect(created).toMatchObject({ title: 'qa-platform', body: 'automated test post', userId: 1 });
    expect(created).toHaveProperty('id');
  });

  test('PUT /posts/:id replaces a post', async ({ request }) => {
    const response = await request.put('/posts/1', {
      data: { id: 1, title: 'updated title', body: 'updated body', userId: 1 },
    });
    expect(response.status()).toBe(200);

    const updated = await response.json();
    expect(updated).toMatchObject({ id: 1, title: 'updated title', body: 'updated body' });
  });

  test('PATCH /posts/:id partially updates a post', async ({ request }) => {
    const response = await request.patch('/posts/1', {
      data: { title: 'patched title' },
    });
    expect(response.status()).toBe(200);

    const patched = await response.json();
    expect(patched.title).toBe('patched title');
  });

  test('DELETE /posts/:id removes a post', async ({ request }) => {
    const response = await request.delete('/posts/1');
    expect(response.status()).toBe(200);
  });
});
