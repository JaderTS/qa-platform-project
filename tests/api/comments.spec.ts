import { test, expect } from '@playwright/test';

test.describe('Comments API', () => {
  test('GET /comments?postId= filters comments by post', async ({ request }) => {
    const response = await request.get('/comments?postId=1');
    expect(response.status()).toBe(200);

    const comments = await response.json();
    expect(comments.length).toBeGreaterThan(0);
    for (const comment of comments) {
      expect(comment.postId).toBe(1);
      expect(comment.email).toMatch(/.+@.+\..+/);
    }
  });

  test('GET /comments/:id returns a single comment', async ({ request }) => {
    const response = await request.get('/comments/1');
    expect(response.status()).toBe(200);

    const comment = await response.json();
    expect(comment.id).toBe(1);
    expect(comment).toHaveProperty('body');
  });
});
