import { test, expect } from '@playwright/test';

test.describe('Users API', () => {
  test('GET /users returns 10 users with the expected shape', async ({ request }) => {
    const response = await request.get('/users');
    expect(response.status()).toBe(200);

    const users = await response.json();
    expect(users).toHaveLength(10);

    for (const user of users) {
      expect(user).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        username: expect.any(String),
        email: expect.stringMatching(/.+@.+\..+/),
        address: expect.objectContaining({
          street: expect.any(String),
          city: expect.any(String),
          zipcode: expect.any(String),
          geo: expect.objectContaining({
            lat: expect.any(String),
            lng: expect.any(String),
          }),
        }),
        company: expect.objectContaining({
          name: expect.any(String),
        }),
      });
    }
  });

  test('GET /users/:id returns a single user', async ({ request }) => {
    const response = await request.get('/users/1');
    expect(response.status()).toBe(200);

    const user = await response.json();
    expect(user.id).toBe(1);
    expect(user.email).toContain('@');
  });

  test('GET /users/:id/albums returns the user albums', async ({ request }) => {
    const response = await request.get('/users/1/albums');
    expect(response.status()).toBe(200);

    const albums = await response.json();
    expect(Array.isArray(albums)).toBe(true);
    for (const album of albums) {
      expect(album.userId).toBe(1);
    }
  });
});
