import { render, screen } from '@testing-library/react';
import { Home } from './Home';

describe('Home', () => {
  it('shows the project name as the heading', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: '__PROJECT_NAME__' })).toBeInTheDocument();
  });

  it('says plainly that nothing is built yet, rather than looking finished', () => {
    // A scaffold that looks like a product invites somebody to believe it is
    // one, and the first honest thing this page can do is say what it is.
    render(<Home />);
    expect(screen.getByText(/nothing else is built yet/u)).toBeInTheDocument();
  });
});
